/* STARFALL Phase 1 — hud.js
 * DOM HUD: hull/shield bars, credits, ore, system name, weapon button, minimap canvas.
 * Toasts + red damage flash vignette.
 */

/* skills-system-retry: synchronously load js/skills.js during the initial
 * parse. This phase's file scope excludes index.html, so no <script> tag can
 * be added there; hud.js (in scope, and loaded after every game module it
 * wraps) bootstraps it. Guarded + idempotent: if a later phase adds a real
 * script tag to index.html, that copy wins and this becomes a no-op. */
(function () {
  if (window.SF && SF.Skills) return;
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.write('<script src="js/skills.js"><\/script>');
  } else if (typeof console !== 'undefined') {
    console.warn('[skills] bootstrap skipped: document not loading and SF.Skills missing');
  }
})();

/* codex-bestiary: synchronously load js/codex.js during the initial parse
 * (same skills-system-retry pattern as above: hud.js is in scope and loads
 * before campaign.js/main.js, which codex wraps lazily). Guarded +
 * idempotent: if a later phase adds a real <script> tag to index.html,
 * that copy wins and this becomes a no-op. ADDED BY COORDINATOR at
 * safe-room merge audit-20261021-1432 (builder scope was js/codex.js only). */
(function () {
  if (window.SF && SF.CodexBestiary) return;
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.write('<script src="js/codex.js"><\/script>');
  } else if (typeof console !== 'undefined') {
    console.warn('[codex] bootstrap skipped: document not loading and SF.CodexBestiary missing');
  }
})();

/* ================= mobile-ux-pass phase =================
 * SF.Haptics: navigator.vibrate haptics on fire/hit/dock/kill, wired by
 * wrapping SF.Audio triggers (no edits to out-of-scope files needed).
 * Preference lives in localStorage 'starfall_haptics_v1' — save-neutral
 * (never touches starfall_save_v1 or SAVE_VERSION).
 * SF.UX: touch-first tuning — move-stick dead zone applied by wrapping
 * SF.Input.poll (js/input.js is outside this phase's file scope; the wrap
 * is additive and idempotent).
 */
window.SF = window.SF || {};

SF.Haptics = (function () {
  var KEY = 'starfall_haptics_v1';
  var hooked = false;
  var enabled = true;
  var lastBuzz = {};
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) { var s = JSON.parse(raw); if (typeof s.enabled === 'boolean') enabled = s.enabled; }
  } catch (e) { /* storage unavailable: default on */ }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled: enabled })); } catch (e) {}
  }
  function canVibrate() {
    return enabled && typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function' &&
      window.SF && SF.Audio && !SF.Audio.isMuted();
  }
  function buzz(pattern, throttleKey, minMs) {
    if (!canVibrate()) return false;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (throttleKey) {
      if (lastBuzz[throttleKey] && now - lastBuzz[throttleKey] < minMs) return false;
      lastBuzz[throttleKey] = now;
    }
    try { return !!navigator.vibrate(pattern); } catch (e) { return false; }
  }
  function hookOnce() {
    if (hooked || !window.SF || !SF.Audio) return;
    hooked = true;
    function wrap(name, fn) {
      var orig = SF.Audio[name];
      if (typeof orig !== 'function' || orig._hapticWrapped) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { fn.apply(this, arguments); } catch (e) {}
        return r;
      };
      w._hapticWrapped = true;
      SF.Audio[name] = w;
    }
    wrap('weaponSound', function () { buzz(8, 'fire', 90); });            // player fires
    wrap('hit',         function () { buzz(25, 'hit', 120); });           // player hull hit
    wrap('shieldHit',   function () { buzz(15, 'hit', 120); });           // shield absorbs
    wrap('explosion',   function (big) { buzz(big ? 45 : 25, 'kill', 150); }); // kill / blast
    wrap('dock',        function () { buzz([12, 40, 12]); });             // dock / land
  }
  hookOnce();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookOnce); // idempotent late re-hook
  }
  return {
    enabled: function () { return enabled; },
    setEnabled: function (v) { enabled = !!v; persist(); return enabled; },
    toggle: function () { return this.setEnabled(!enabled); },
    play: function (pattern) { return buzz(pattern); },
    _hook: hookOnce // test hook
  };
})();

SF.UX = (function () {
  var MOVE_DEADZONE = 0.12; // move-stick deflections below this are ignored
  if (window.SF && SF.Input && typeof SF.Input.poll === 'function' && !SF.Input.poll._uxWrapped) {
    var _poll = SF.Input.poll;
    var wrapped = function () {
      _poll.call(this);
      var m = Math.hypot(this.mx, this.my);
      if (m > 0 && m < MOVE_DEADZONE) { this.mx = 0; this.my = 0; }
    };
    wrapped._uxWrapped = true;
    SF.Input.poll = wrapped;
  }
  return { MOVE_DEADZONE: MOVE_DEADZONE };
})();

window.SF = window.SF || {};

SF.HUD = (function () {  var el = {};
  var mm, mmctx;
  var toastTimer = null;
  var lastWeapon = '';
  var dockTarget = null; // planets-facilities: station entry the dock button will use

  function $(id) { return document.getElementById(id); }

  return {
    init: function () {
      ['hud', 'hull-fill', 'shield-fill', 'hud-credits', 'hud-ore', 'hud-cargo', 'hud-system', 'hud-crew',
       'hud-factions', 'hud-karma',
       'weapon-btn', 'dock-prompt', 'board-prompt', 'btn-board', 'rescue-prompt', 'btn-rescue',
       'investigate-prompt', 'btn-investigate',
       'toast', 'damage-flash', 'btn-map', 'btn-mute', 'btn-quests',
       'btn-save', 'btn-fire', 'joystick', 'joy-knob', 'btn-dock', 'btn-news'
      ].forEach(function (id) { el[id] = $(id); });
      mm = $('minimap');
      mmctx = mm.getContext('2d');
      // threat-ring-legend (2026-10-21): install the legend chip (additive; guards for headless)
      if (window.SF && SF.ThreatLegend && typeof SF.ThreatLegend.install === 'function') SF.ThreatLegend.install();

      el['weapon-btn'].addEventListener('click', function () { SF.Player.cycleWeapon(); SF.Audio.unlock(); });
      el['btn-map'].addEventListener('click', function () {
        SF.Audio.unlock();
        if (SF.Game.state === 'PLAYING') SF.Game.setState('STARMAP');
      });
      el['btn-mute'].addEventListener('click', function () {
        var m = SF.Audio.toggleMute();
        el['btn-mute'].textContent = m ? '🔇' : '🔊';
        SF.Audio.unlock();
      });
      el['btn-mute'].textContent = SF.Audio.isMuted() ? '🔇' : '🔊';
      // mobile-ux-pass: haptics toggle lives in the audio settings overlay
      // (index.html #overlay-settings, wired here since js/audio.js is out of scope)
      var hbtn = $('set-haptics');
      function paintHaptics() {
        if (hbtn && window.SF && SF.Haptics) {
          hbtn.textContent = SF.Haptics.enabled() ? '📳 haptics on' : '📳 haptics off';
        }
      }
      if (hbtn && window.SF && SF.Haptics) {
        hbtn.addEventListener('click', function () {
          SF.Audio.unlock(); SF.Haptics.toggle(); paintHaptics(); SF.Audio.ui();
        });
        paintHaptics();
        ['btn-settings', 'btn-title-settings'].forEach(function (id) {
          var b = $(id);
          if (b) b.addEventListener('click', paintHaptics);
        });
      }
      el['btn-save'].addEventListener('click', function () {
        if (SF.Save.save()) { SF.HUD.toast('Progress saved'); SF.Audio.ui(); }
        else { SF.HUD.toast('Save failed'); SF.Audio.deny(); }
      });
      el['btn-dock'].addEventListener('click', function () {
        SF.Audio.unlock();
        SF.Station.dock(dockTarget || undefined);
      });
      // planets-facilities: news overlay
      if (el['btn-news']) el['btn-news'].addEventListener('click', function () {
        SF.Audio.unlock();
        if (window.SF && SF.News) SF.News.open();
      });
      // planets-facilities: overlay close buttons
      var nc = document.getElementById('btn-news-close');
      if (nc) nc.addEventListener('click', function () { SF.Audio.unlock(); SF.News.close(); });
      var bc = document.getElementById('btn-blackmarket-close');
      if (bc) bc.addEventListener('click', function () { SF.Audio.unlock(); SF.BlackMarket.close(); });
      var lf = document.getElementById('btn-liftoff');
      if (lf) lf.addEventListener('click', function () { SF.Planets.liftoff(); });
      el['btn-quests'].addEventListener('click', function () {
        SF.Audio.unlock();
        if (SF.Game.state === 'PLAYING') SF.Quests.openLog();
      });
      // skills-system-retry: skills button + XP readout are runtime-created
      // (index.html is outside this phase's file scope)
      if (window.SF && SF.Skills) {
        var sbtn = document.createElement('button');
        sbtn.id = 'btn-skills';
        sbtn.className = 'btn small ui-block';
        sbtn.textContent = '🎓 SKILLS [K]';
        sbtn.addEventListener('click', function () {
          SF.Audio.unlock();
          if (SF.Game.state === 'PLAYING') SF.Skills.openUI();
        });
        var hbb = $('hud-buttons');
        if (hbb) hbb.appendChild(sbtn);
        el['btn-skills'] = sbtn;
        var sro = document.createElement('div');
        sro.id = 'hud-skills';
        sro.className = 'stat';
        var hst = $('hud-stats');
        if (hst) hst.appendChild(sro);
        el['hud-skills'] = sro;
        window.addEventListener('keydown', function (e) {
          if (e.code === 'KeyK' && SF.Game.state === 'PLAYING') SF.Skills.openUI();
          else if (e.code === 'Escape') SF.Skills.closeUI();
        });
      }
      el['btn-board'].addEventListener('click', function () {
        SF.Audio.unlock();
        var t = SF.Boarding.findTarget(SF.Player);
        if (t) SF.Boarding.open(t);
      });
      el['btn-investigate'].addEventListener('click', function () {
        SF.Audio.unlock();
        var t = SF.Secrets.nearSecret(SF.Player, SF.Game.systemId);
        if (t) SF.Secrets.investigate(t);
      });
      el['btn-rescue'].addEventListener('click', function () {
        SF.Audio.unlock();
        SF.Game.rescue();
      });
    },

    showHud: function (v) {
      el.hud.classList.toggle('hidden', !v);
      // planets-facilities: refresh the news ticker when the HUD appears
      var tick = document.getElementById('news-ticker');
      if (tick) tick.classList.toggle('hidden', !v);
      if (v && window.SF && SF.News) SF.News.paint();
    },

    hidePrompts: function () {
      el['dock-prompt'].classList.add('hidden');
      el['board-prompt'].classList.add('hidden');
      el['rescue-prompt'].classList.add('hidden');
      el['investigate-prompt'].classList.add('hidden'); // Phase 5
    },

    /* Phase 5: derelict / anomaly investigate prompt */
    showInvestigatePrompt: function (target) {
      var show = !!target;
      el['investigate-prompt'].classList.toggle('hidden', !show);
      if (show) {
        /* secrets-easter-eggs: label new secret kinds */
        el['btn-investigate'].textContent = target.kind === 'derelict'
          ? '🔍 INVESTIGATE ' + target.d.name.toUpperCase() + ' [E]'
          : (target.kind === 'dungeon'
              ? '☠ BOARD ' + target.d.name.toUpperCase() + ' [E]'
              : (target.kind === 'lifepod'
                  ? '🛟 INVESTIGATE LIFEPOD [E]'
                  : '✦ INVESTIGATE ANOMALY [E]'));
      }
    },

    showBoardPrompt: function (target) {
      var show = !!target;
      el['board-prompt'].classList.toggle('hidden', !show);
      if (show) {
        el['btn-board'].textContent = target.adrift
          ? '⚔ BOARD DERELICT [B]'
          : '⚔ BOARD ' + target.spec.scoreName.toUpperCase() + ' [B]';
      }
    },

    showDockPrompt: function (v, inRange, st) {
      el['dock-prompt'].classList.toggle('hidden', !v);
      el['btn-dock'].disabled = !inRange;
      dockTarget = st || null; // planets-facilities: remember the target entry
      var verb = (st && st.kind === 'planet') ? '🛬 LAND ON ' : '🛬 DOCK AT ';
      el['btn-dock'].textContent = inRange
        ? verb + (st ? st.name.toUpperCase() : '') + ' [E]'
        : 'MOVE CLOSER TO DOCK';
    },

    damageFlash: function () {
      el['damage-flash'].classList.remove('hidden');
      el['damage-flash'].style.opacity = '0.45';
      setTimeout(function () { el['damage-flash'].style.opacity = '0'; }, 60);
      setTimeout(function () { el['damage-flash'].classList.add('hidden'); }, 400);
    },

    toast: function (msg) {
      el.toast.textContent = msg;
      el.toast.classList.remove('hidden');
      el.toast.classList.remove('toast-anim');
      void el.toast.offsetWidth; // restart animation
      el.toast.classList.add('toast-anim');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 2200);
    },

    update: function () {
      var p = SF.Player;
      var hf = Math.max(0, p.hull / p.maxHull());
      var sf = Math.max(0, p.shield / p.maxShield());
      el['hull-fill'].style.transform = 'scaleX(' + hf.toFixed(3) + ')';
      el['shield-fill'].style.transform = 'scaleX(' + sf.toFixed(3) + ')';
      el['hull-fill'].style.background = hf > 0.5 ? '#3ddc5f' : (hf > 0.25 ? '#ffcf5e' : '#ff5e3a');
      el['hud-credits'].textContent = Math.floor(p.credits).toLocaleString('en-US');
      el['hud-ore'].textContent = Math.floor(p.ore).toLocaleString('en-US');
      // Phase 5: cargo readout
      if (el['hud-cargo']) {
        var cu = p.cargoUsed(), cs = p.cargoSpace();
        el['hud-cargo'].textContent = '📦 ' + cu + '/' + cs + 't';
        el['hud-cargo'].style.color = cu >= cs ? '#ff5e3a' : '#ffd23f';
      }
      // Phase 3: crew number under the bars (headline readout)
      var cc = p.crewCount(), ccap = p.crewCapacity();
      el['hud-crew'].textContent = '👥 ' + cc + '/' + ccap;
      el['hud-crew'].style.color = cc === 0 && p.activeShipDef().hadCrew ? '#ff5e3a' : '#ffd23f';
      // Phase 3: rescue prompt when adrift
      var adrift = p.isAdrift();
      el['rescue-prompt'].classList.toggle('hidden', !adrift);
      if (adrift) {
        el['btn-rescue'].textContent = '🆘 ADRIFT — RESCUE TOW · ' +
          Math.floor(SF.CONFIG.crew.rescueCost).toLocaleString('en-US') + 'c';
        el['btn-rescue'].disabled = p.credits < SF.CONFIG.crew.rescueCost;
      }
      var sys = SF.SYSTEM_BY_ID[SF.Game.systemId];
      /* open-space-1: outside every region cell the readout says so —
       * systemId itself stays the last region visited (theme, encounters
       * and difficulty all key off it), so only the label changes. */
      var deep = false;
      try { deep = window.SF && SF.Space && SF.Space.deepSpace(); } catch (e) {}
      el['hud-system'].textContent = deep ? 'Deep Space' : (sys ? sys.name : '');
      el['hud-system'].style.color = deep ? '#9adfff' : (sys ? sys.color : '#fff');
      // Phase 4: faction standings + karma
      if (el['hud-factions'] && window.SF && SF.Factions) {
        el['hud-factions'].innerHTML = SF.FACTION_LIST.map(function (f) {
          var v = SF.Factions.standing(f.id);
          return '<span style="color:' + f.color + '">' + f.short + ' ' +
            (v >= 0 ? '+' : '') + v + '</span>';
        }).join(' · ');
      }
      if (el['hud-karma'] && window.SF && SF.Factions) {
        var k = SF.Factions.karma();
        el['hud-karma'].innerHTML = '\u262f ' + (k >= 0 ? '+' : '') + k + ' · ' +
          SF.Factions.karmaLabel(k);
        el['hud-karma'].style.color = k <= -30 ? '#ff5e3a' : (k >= 30 ? '#3ddc5f' : '#ffd23f');
      }
      // skills-system-retry: XP / level / unspent-points readout
      if (el['hud-skills'] && window.SF && SF.Skills) {
        var sks = SF.Skills.state(), sil = SF.Skills.xpIntoLevel();
        var skt = '🎓 Lv' + sks.level + ' ' + sks.xp + '/' + sil.need + ' XP' +
          (sks.points > 0 ? ' · <b>+' + sks.points + 'pts</b>' : '');
        if (el['hud-skills']._t !== skt) {
          el['hud-skills']._t = skt;
          el['hud-skills'].innerHTML = skt;
        }
      }
      // hud-declutter-1: the standing / karma / XP readouts are hidden on
      // the main HUD (css) and mirrored into the MENU drawer's stats strip
      // (#drawer-stats, index.html) so the detail stays one tap away
      // without crowding the top-center stack.
      var dstats = document.getElementById('drawer-stats');
      if (dstats && window.SF && SF.Factions) {
        var dstr = SF.FACTION_LIST.map(function (f) {
          var v = SF.Factions.standing(f.id);
          return f.short + ' ' + (v >= 0 ? '+' : '') + v;
        }).join(' · ') + '  |  ' + SF.Factions.karmaLabel(SF.Factions.karma()) +
          ' ' + (SF.Factions.karma() >= 0 ? '+' : '') + SF.Factions.karma();
        if (window.SF && SF.Skills) {
          var dsk = SF.Skills.state(), dsi = SF.Skills.xpIntoLevel();
          dstr += '  |  Lv' + dsk.level + ' ' + dsk.xp + '/' + dsi.need + ' XP' +
            (dsk.points > 0 ? ' (+' + dsk.points + ' pts)' : '');
        }
        if (dstats._t !== dstr) { dstats._t = dstr; dstats.textContent = dstr; }
      }
      // boss-encounters: paint the boss health bar (runtime DOM, no index.html edit)
      if (window.SF && SF.BossBar) SF.BossBar.update();
      var w = p.currentWeapon();
      var wkey = w ? w.id + ':' + (w.stars || 1) : '';
      if (w && wkey !== lastWeapon) {
        lastWeapon = wkey;
        el['weapon-btn'].innerHTML = '<span class="tier-dot" style="background:' +
          SF.TIERS[w.tier] + '"></span>' + w.name + ' <span style="color:#ffd23f">' +
          SF.Upgrade.starsText(w.stars || 1) + '</span>';
        el['weapon-btn'].style.borderColor = SF.TIERS[w.tier];
      }
      this.drawMinimap();
      // quest-tracker: objective markers + tracker line (overlay canvas + DOM)
      if (window.SF && SF.Tracker) SF.Tracker.paint();
      // hud-damage-direction-retry-3: directional damage arcs + vignette + shield flash
      if (window.SF && SF.DamageFX) SF.DamageFX.paint();
    },

    drawMinimap: function () {
      var W = mm.width, H = mm.height;
      /* open-space-1: player-centered window (radius SF.Space.MM_RADIUS),
       * NOT the old whole-square map. The window follows the player into
       * deep space; region cells draw as faint outlines when in view.
       * Falls back to the old whole-square scale if SF.Space is absent. */
      var hasSpace = !!(window.SF && SF.Space && SF.Space.minimapTransform);
      var tr = hasSpace ? SF.Space.minimapTransform(mm) : null;
      var ws = SF.CONFIG.worldSize;
      var sx = tr ? tr.sx : W / ws, sy = tr ? tr.sy : H / ws;
      var mx = tr ? tr.x : function (wx) { return wx * sx; };
      var my = tr ? tr.y : function (wy) { return wy * sy; };
      mmctx.clearRect(0, 0, W, H);
      mmctx.fillStyle = 'rgba(4,8,20,0.85)';
      mmctx.fillRect(0, 0, W, H);
      if (hasSpace) {
        /* region cells in view: faint outline + name; the current region
         * is brighter. In deep space every nearby cell still shows, so
         * the way back is visible on the map. */
        SF.SYSTEMS.forEach(function (sys) {
          var c = SF.Space.cellOf(sys.id);
          var x0 = mx(c.x0), y0 = my(c.y0), x1 = mx(c.x1), y1 = my(c.y1);
          if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return;
          mmctx.save();
          mmctx.strokeStyle = sys.color;
          mmctx.globalAlpha = (sys.id === SF.Game.systemId) ? 0.55 : 0.25;
          mmctx.lineWidth = 1;
          mmctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
          mmctx.globalAlpha = 0.8;
          mmctx.fillStyle = sys.color;
          mmctx.font = '9px sans-serif';
          mmctx.fillText(sys.name, Math.max(2, x0 + 3), Math.max(11, y0 + 11));
          mmctx.restore();
        });
        if (SF.Space.deepSpace()) {
          mmctx.save();
          mmctx.fillStyle = '#9adfff';
          mmctx.font = 'bold 10px sans-serif';
          mmctx.textAlign = 'center';
          mmctx.fillText('DEEP SPACE', W / 2, 13);
          mmctx.restore();
        }
      }

      var i, a;
      // asteroids
      mmctx.fillStyle = '#55556a';
      var al = SF.Asteroids.list;
      for (i = 0; i < al.length; i++) {
        a = al[i]; if (a.dead) continue;
        mmctx.fillRect(mx(a.x) - 1, my(a.y) - 1, 2, 2);
      }
      // station
      var sp = SF.Station.stationPos(SF.Game.systemId);
      if (sp) {
        mmctx.fillStyle = '#39d5e8';
        mmctx.fillRect(mx(sp.x) - 3, my(sp.y) - 3, 6, 6);
      }
      // planets-facilities: planets (circles) + faction HQs (faction color)
      if (window.SF && SF.Planets) SF.Planets.list(SF.Game.systemId).forEach(function (pl) {
        mmctx.fillStyle = pl.color;
        mmctx.beginPath(); mmctx.arc(mx(pl.x), my(pl.y), 3, 0, Math.PI * 2); mmctx.fill();
      });
      if (window.SF && SF.HQ) SF.HQ.list(SF.Game.systemId).forEach(function (hq) {
        mmctx.fillStyle = SF.FACTION_BY_ID[hq.factionId].color;
        mmctx.fillRect(mx(hq.x) - 3, my(hq.y) - 3, 6, 6);
      });
      // Phase 5: homebase (gold) + mission waypoint (diamond)
      if (window.SF && SF.Homebase) {
        var hb = SF.Homebase.get();
        if (hb && hb.systemId === SF.Game.systemId) {
          mmctx.fillStyle = '#ffd23f';
          mmctx.fillRect(mx(hb.x) - 3, my(hb.y) - 3, 6, 6);
        }
      }
      if (SF.Game.waypoint && SF.Game.waypoint.systemId === SF.Game.systemId) {
        var wp = SF.Game.waypoint;
        mmctx.fillStyle = '#ff4fd8';
        var wx = mx(wp.x), wy = my(wp.y);
        mmctx.beginPath();
        mmctx.moveTo(wx, wy - 4); mmctx.lineTo(wx + 4, wy);
        mmctx.lineTo(wx, wy + 4); mmctx.lineTo(wx - 4, wy);
        mmctx.closePath(); mmctx.fill();
      }
      // enemies (boss-encounters: bosses get a bigger blip + gold ring)
      var el2 = SF.Enemies.list;
      for (i = 0; i < el2.length; i++) {
        a = el2[i];
        if (a.boss) {
          mmctx.fillStyle = '#ff5e3a';
          mmctx.fillRect(mx(a.x) - 2.5, my(a.y) - 2.5, 5, 5);
          mmctx.strokeStyle = '#ffd23f';
          mmctx.strokeRect(mx(a.x) - 4.5, my(a.y) - 4.5, 9, 9);
        } else {
          mmctx.fillStyle = '#ff5e3a';
          mmctx.fillRect(mx(a.x) - 1.5, my(a.y) - 1.5, 3, 3);
        }
      }
      // player
      mmctx.fillStyle = '#fff';
      mmctx.beginPath();
      mmctx.arc(mx(SF.Player.x), my(SF.Player.y), 3, 0, Math.PI * 2);
      mmctx.fill();
      // minimap-threat-rings (2026-10-21): threat rings drawn over the blips,
      // under the player dot and the border
      if (window.SF && SF.ThreatRings) SF.ThreatRings.paint(mmctx, mm.width, mm.height);
      // threat-ring-legend (2026-10-21): toggleable canvas legend, drawn over the rings
      if (window.SF && SF.ThreatLegend) SF.ThreatLegend.paint(mmctx, mm.width, mm.height);
      // border
      mmctx.strokeStyle = 'rgba(120,160,220,0.5)';
      mmctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    }
  };
})();

/* ================= minimap-threat-rings phase (2026-10-21) =================
 * SF.ThreatRings: combat-awareness rings on the HUD minimap.
 *  - elites        -> pulsing orange rings
 *  - bosses        -> pulsing red rings
 *  - notorious hunters (bounty-hunters-hunted) -> pulsing purple rings
 * Ring pulse rate scales with player proximity (faster when closer); the
 * graphics-juice quality tiers apply — on the Low tier rings are static
 * (no pulse). Priority when flags overlap: hunter > boss > elite.
 *
 * Save-neutral: reads SF.Enemies.list + SF.FX.getEffective() at render time
 * only; no save fields touched, SAVE_VERSION untouched. Scope is js/hud.js
 * only — drawMinimap calls paint() at the end of its body (one hook line).
 *
 * Test hook: snapshot() returns the computed ring data in minimap-pixel
 * coordinates so headless smoke tests can assert colors, positions, radii
 * and pulse rates without pixel-racing.
 */
SF.ThreatRings = (function () {
  'use strict';

  var COLORS = { elite: '#ff9d2e', boss: '#ff2e1f', hunter: '#b45cff' };
  var BASE_R = 7;       // px radius at the pulse mid-point
  var PULSE_AMP = 2;    // px radius swing
  var MAX_DIST = 4000;  // world units; beyond this the rate is at its floor
  var RATE_NEAR = 10, RATE_FAR = 2.5; // pulse angular velocity, rad/s

  function kindOf(e) {
    if (e.hunter) return 'hunter';
    if (e.boss) return 'boss';
    if (e.elite) return 'elite';
    return null;
  }

  function lowQuality() {
    try {
      return window.SF && SF.FX && typeof SF.FX.getEffective === 'function' &&
        SF.FX.getEffective() === 'low';
    } catch (e) { return false; }
  }

  /* pulse rate (rad/s) from player distance: faster when closer */
  function pulseRate(dist) {
    var f = Math.max(0, 1 - dist / MAX_DIST);
    return RATE_FAR + (RATE_NEAR - RATE_FAR) * f;
  }

  function snapshot() {
    var out = [];
    try {
      if (!window.SF || !SF.Enemies || !SF.Enemies.list || !SF.Player ||
          !SF.CONFIG || !SF.CONFIG.worldSize) return out;
      var mm = document.getElementById('minimap');
      if (!mm || !mm.width) return out;
      /* open-space-1: rings follow the player-centered minimap window. */
      var tr = (window.SF && SF.Space && SF.Space.minimapTransform) ?
        SF.Space.minimapTransform(mm) : null;
      var sx = tr ? tr.sx : mm.width / SF.CONFIG.worldSize;
      var sy = tr ? tr.sy : mm.height / SF.CONFIG.worldSize;
      var mxF = tr ? tr.x : function (wx) { return wx * sx; };
      var myF = tr ? tr.y : function (wy) { return wy * sy; };
      var low = lowQuality();
      var now = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) / 1000;
      var list = SF.Enemies.list;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || e.dead) continue;
        var kind = kindOf(e);
        if (!kind) continue;
        var dist = Math.hypot(e.x - SF.Player.x, e.y - SF.Player.y);
        var rate, r, alpha;
        if (low) {
          rate = 0; r = BASE_R; alpha = 0.85;
        } else {
          rate = pulseRate(dist);
          var ph = 0.5 + 0.5 * Math.sin(now * rate);
          r = BASE_R + (ph - 0.5) * 2 * PULSE_AMP;
          alpha = 0.5 + 0.45 * ph;
        }
        out.push({
          kind: kind, color: COLORS[kind],
          mx: Math.round(mxF(e.x) * 10) / 10, my: Math.round(myF(e.y) * 10) / 10,
          r: Math.round(r * 100) / 100, alpha: Math.round(alpha * 100) / 100,
          rate: Math.round(rate * 1000) / 1000,
          dist: Math.round(dist)
        });
      }
    } catch (e) { /* render path must never throw */ }
    return out;
  }

  function paint(ctx, w, h) {
    if (!ctx || w <= 0) return;
    var rings = snapshot();
    for (var i = 0; i < rings.length; i++) {
      var g = rings[i];
      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.mx, g.my, g.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  return {
    snapshot: snapshot,
    paint: paint,
    colors: function () { return { elite: COLORS.elite, boss: COLORS.boss, hunter: COLORS.hunter }; },
    pulseRate: pulseRate,
    BASE_R: BASE_R,
    kindOf: kindOf // exposed for tests
  };
})();

/* ================= ui-cleanup-drawer phase (2026-10-20) =================
 * User playtest feedback (S25 screenshot): the flight HUD is too tight —
 * the left #hud-buttons column ate ~19% of the screen and the quest tracker
 * banner overlapped the canvas-drawn reactor stance tabs (ship.js).
 *
 * What changed (DOM moved, never rebuilt — ids + listeners + shortcuts intact):
 *  - #hud-buttons now lives INSIDE #menu-drawer (slide-over panel). Buttons
 *    MAP/QUESTS/NEWS/SAVE/MUTE/SETTINGS keep their ids and hud.js wiring;
 *    runtime-appended buttons (btn-skills, btn-navhold, btn-targetlock) still
 *    append to #hud-buttons via getElementById, so they land in the drawer too.
 *  - #weapon-btn is a slim one-line chip under the bars (icon + name + stars).
 *  - #btn-menu (☰ MENU) opens the drawer; it closes on selection, outside tap
 *    (scrim), or MENU again. #hud top bar condensed via CSS; faction/karma
 *    render as compact chips; #btn-minimap-toggle hides the minimap (pref in
 *    localStorage 'starfall_minimap_v1'; default was shown here, flipped to
 *    HIDDEN by hud-declutter-1 — see isMinimapHidden).
 *  - #hud-tracker banner moved below the reactor stance row (ship.js
 *    canvas-drawn at y=64..~132 centered) — tracker now sits at y=146 so the
 *    banner can never cover the BAL/AST/AEG/OVR tabs. ship.js is out of this
 *    phase's scope, so the tabs' row stays where it is; the tracker moved.
 *  - Save-neutral: DOM/CSS/runtime only, no SAVE_VERSION bump, no save-blob
 *    changes. Does NOT touch the just-merged SF.Codex ('C' hotkey + quest-log
 *    CODEX tab live in js/campaign.js — unaffected).
 */
SF.MenuDrawer = (function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var MM_KEY = 'starfall_minimap_v1';
  var drawerOpen = false;

  function setOpen(v) {
    drawerOpen = !!v;
    var d = $('menu-drawer'), s = $('menu-scrim');
    if (d) d.classList.toggle('open', drawerOpen);
    if (s) s.classList.toggle('hidden', !drawerOpen);
  }
  function toggle() { setOpen(!drawerOpen); }
  function isOpen() { return drawerOpen; }

  function paintMinimapToggle() {
    var b = $('btn-minimap-toggle');
    if (!b) return;
    var hidden = isMinimapHidden();
    b.textContent = hidden ? '🚫' : '🗺';
    b.title = hidden ? 'show minimap' : 'hide minimap';
  }
  function isMinimapHidden() {
    // hud-declutter-1: default flips to HIDDEN (user verdict: the 96px
    // minimap is too small to read and only eats the top-right corner).
    // Stored prefs stay meaningful: '1' = pilot explicitly showed it,
    // '0' = explicitly hidden, unset = hidden (the new default). The
    // drawer/corner toggle still brings it back at any time.
    try { return localStorage.getItem(MM_KEY) !== '1'; } catch (e) { return true; }
  }
  function setMinimapHidden(v) {
    try { localStorage.setItem(MM_KEY, v ? '0' : '1'); } catch (e) {}
    var mm = $('minimap');
    if (mm) mm.classList.toggle('minimap-hidden', !!v);
    paintMinimapToggle();
  }

  function install() {
    var mb = $('btn-menu');
    if (mb && !mb._drawerWired) {
      mb._drawerWired = true;
      mb.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.unlock();
        toggle();
      });
    }
    var s = $('menu-scrim');
    if (s && !s._drawerWired) {
      s._drawerWired = true;
      s.addEventListener('click', function () { setOpen(false); });
    }
    // close on selection: any button inside the drawer closes it first —
    // the button's own listener still fires (bubbling: listener runs too).
    var hbb = $('hud-buttons');
    if (hbb && !hbb._drawerWired) {
      hbb._drawerWired = true;
      hbb.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.btn')) setOpen(false);
      });
    }
    var mt = $('btn-minimap-toggle');
    if (mt && !mt._drawerWired) {
      mt._drawerWired = true;
      mt.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.unlock();
        setMinimapHidden(!isMinimapHidden());
      });
    }
    // apply the minimap pref at boot WITHOUT persisting it —
    // hud-declutter-1: setMinimapHidden() writes localStorage, which
    // would manufacture a '0' pref for a pilot who never chose one and
    // freeze today's default into storage. Unset must stay unset.
    var mmBoot = $('minimap');
    if (mmBoot) mmBoot.classList.toggle('minimap-hidden', isMinimapHidden());
    paintMinimapToggle();
    // keep drawer closed when the HUD hides (overlays / state changes)
    if (window.SF && SF.HUD && typeof SF.HUD.showHud === 'function' && !SF.HUD.showHud._drawerWrapped) {
      var orig = SF.HUD.showHud;
      var wrapped = function (v) { if (!v) setOpen(false); return orig.call(this, v); };
      wrapped._drawerWrapped = true;
      SF.HUD.showHud = wrapped;
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  }
  return {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: toggle,
    isOpen: isOpen,
    toggleMinimap: function () { setMinimapHidden(!isMinimapHidden()); },
    isMinimapHidden: isMinimapHidden
  };
})();

/* ================= tutorial-onboarding phase =================
 * SF.Tutorial: first-flight overlay walkthrough (fly, fire, mine, dock,
 * buy weapon, jump systems) + contextual tips on first dock / jump /
 * weapon purchase. Dismissible + skippable; returning players (flag set)
 * never see it. Progress lives in localStorage 'starfall_tutorial_v1' —
 * SAVE-NEUTRAL (never touches starfall_save_v1 or SAVE_VERSION).
 *
 * Integration is strictly additive and idempotent: it wraps
 * SF.Game.newGame / SF.Station.dock / SF.Game.travelTo (guarded,
 * _tutorialWrapped) and creates its own DOM + <style> at runtime, so
 * js/main.js, js/station.js, css/style.css and index.html are untouched.
 * A 400ms interval drives step completion polling (works in DOCKED too,
 * where the buy-weapon step completes).
 */
SF.Tutorial = (function () {
  var KEY = 'starfall_tutorial_v1';
  var st = { seen: false, done: false, step: 0, tips: {} };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        st.seen = !!s.seen; st.done = !!s.done;
        st.step = Math.max(0, s.step | 0); st.tips = s.tips || {};
      }
    }
  } catch (e) { /* storage unavailable: tutorial just runs fresh */ }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
  }

  var hooked = false, active = false, minimized = false, built = false;
  var startX = 0, startY = 0, startOre = 0, startWeapons = 1, tipWeaponBase = -1;
  var ov = null, chip = null;

  var STEPS = [
    { id: 'intro', title: 'WELCOME, PILOT',
      body: 'This is Solace system, and that rust-bucket is yours. You just watched ' +
        '(or skipped) the ~30-second story intro — this walkthrough is the second ' +
        'and last part of setup, about two minutes: fly, shoot, mine, dock, buy a ' +
        'gun, and jump to the next system. Both parts are skippable.',
      obj: 'Tap CONTINUE to begin your first flight.', manual: true },
    { id: 'fly', title: 'FLY',
      body: 'Drag the left stick (or WASD / arrows) to thrust. The right stick aims and fires.',
      obj: 'Fly 250m in any direction.' },
    { id: 'fire', title: 'FIRE',
      body: 'Hold the FIRE button (or Space) to shoot straight ahead. Your pulse cannon ' +
        'never runs out of ammo. When an enemy sticks close behind you, drag anywhere on ' +
        'the right side of the screen to aim and fire in any direction.',
      obj: 'Fire your weapon.' },
    { id: 'mine', title: 'MINE',
      body: 'Blast the grey asteroids apart and fly through the glowing ore chunks to scoop them.',
      obj: 'Collect 1 ore.' },
    { id: 'dock', title: 'DOCK',
      body: 'Fly into the dashed ring around Haven Dock and press DOCK (or E). Docking saves your game.',
      obj: 'Dock at Haven Dock.' },
    { id: 'buy', title: 'BUY A WEAPON',
      body: 'In the station store, open the WEAPONS tab and buy a weapon. ' +
        'Tap your weapon button in the HUD to swap hardpoints mid-flight.',
      obj: 'Buy a weapon.' },
    { id: 'jump', title: 'JUMP SYSTEMS',
      body: 'Undock, open the star map [M], and jump to DRIFT. Heads-up: rookie grace ' +
        'is Solace-only and fades as you level (full at Lv1, gone by Lv3). Outside ' +
        'Solace patrols hit at full damage, and Drift runs 1.25x system strength — ' +
        'expect a real fight, and richer ore.',
      obj: 'Jump to another system.' }
  ];

  /* twelve-hour-wave1: the buy step used to stall — a fresh pilot starts on
   * 60c and the cheapest buyable weapon is 180c, and nothing said to sell
   * ore. The step text is now computed live from the player's wallet, so a
   * tutorial-following player always knows the exact ore count still
   * needed (ore sells at 5c in Commerce -> Sell). No economy change: the
   * grind is ~6-12 asteroids (2-4 ore each) for the 24-ore gap, short
   * enough to teach mining-as-income without touching prices. */
  function buyGuidance() {
    var credits = 0, ore = 0;
    try { credits = Math.floor(SF.Player.credits); ore = Math.floor(SF.Player.ore); } catch (e) {}
    /* twelve-hour-wave1: hardpoint branch. A pilot with no free mount (the
     * pre-fix starter fit, or a legacy tutorial state) sees greyed-out BUY
     * buttons even with credits — the guidance must name the real chain
     * (buy a Light Hardpoint, fit it in the Ship Builder, then buy a gun)
     * instead of sending them to a button that can never enable. */
    try {
      var owned = SF.Player.weaponsOwned.length, slots = SF.Player.weaponSlots();
      if (owned >= slots) {
        var hpPrice = 250, hpOrePrice = (SF.CONFIG && SF.CONFIG.economy) ? SF.CONFIG.economy.orePrice : 5;
        var hpBody = 'Your ship has no free weapon mount — every BUY button stays greyed ' +
          'out until you fit one. Buy a Light Hardpoint (' + hpPrice + 'c) in Commerce -> Parts, ' +
          'fit it in the Ship Builder, then come back here and buy a weapon.';
        if (credits < hpPrice) {
          hpBody += ' You have ' + credits + 'c — sell ' + Math.ceil((hpPrice - credits) / hpOrePrice) +
            ' ore at ' + hpOrePrice + 'c each (Commerce -> Sell) to afford the mount.';
        }
        return { body: hpBody,
          obj: 'Buy + fit a Light Hardpoint, then buy a weapon.' };
      }
    } catch (e) {}
    var cheapest = null;
    try {
      (SF.WEAPONS || []).forEach(function (w) {
        if (w.price > 0 && !w.craftOnly && (!cheapest || w.price < cheapest.price)) cheapest = w;
      });
    } catch (e) {}
    var price = cheapest ? cheapest.price : 180;
    var name = cheapest ? cheapest.name : 'Shard Pistol';
    var orePrice = (SF.CONFIG && SF.CONFIG.economy) ? SF.CONFIG.economy.orePrice : 5;
    if (credits >= price) {
      return { body: 'You have ' + credits + 'c — you can afford the ' + name + ' (' + price + 'c). ' +
          'Open the WEAPONS tab in the station store and buy it. Tap your weapon ' +
          'button in the HUD to swap hardpoints mid-flight.',
        obj: 'Buy the ' + name + ' (' + price + 'c).' };
    }
    var gap = price - credits;
    var need = Math.ceil(gap / orePrice);
    return { body: 'You have ' + credits + 'c and ' + ore + ' ore — the cheapest gun, the ' + name +
        ', costs ' + price + 'c, so you are ' + gap + 'c short. Mine asteroids, dock at ' +
        'Haven, open Commerce -> Sell, and sell ' + need + ' ore at ' + orePrice + 'c each to ' +
        'close the gap, then buy it here. Tap your weapon button in the HUD to swap ' +
        'hardpoints mid-flight.',
      obj: 'Sell ' + need + ' ore (Commerce -> Sell), then buy a weapon.' };
  }

  var TIPS = {
    dock: 'DOCKED — progress saved. The STORE tab sells weapons, ships and upgrades; ' +
      'CONTRACTS pays for work. Repair and refuel before you undock.',
    jump: 'NEW SYSTEM — rookie grace is Solace-only and fades as you level ' +
      '(full at Lv1, gone by Lv3). Out here patrols hit at full damage — Drift ' +
      'is 1.25x system strength. Check the star map for faction territory ' +
      'before you pick fights.',
    weapon: 'WEAPON INSTALLED — tap the weapon button in the HUD to swap hardpoints mid-flight.'
  };

  /* ---------- DOM ---------- */

  function injectCSS() {
    if (document.getElementById('tutorial-css')) return;
    var css = document.createElement('style');
    css.id = 'tutorial-css';
    css.textContent =
      '#tutorial-overlay{position:fixed;inset:0;z-index:10000;display:flex;' +
      'align-items:flex-start;justify-content:center;pointer-events:none;padding:64px 12px 0}' +
      '#tutorial-card{pointer-events:auto;max-width:520px;width:100%;background:rgba(6,12,26,.94);' +
      'border:1px solid #39d5e8;border-radius:12px;padding:14px 16px;color:#dfe9ff;' +
      'box-shadow:0 0 24px rgba(57,213,232,.35);font-family:inherit}' +
      '#tutorial-progress{font-size:11px;letter-spacing:2px;color:#39d5e8;margin-bottom:4px}' +
      '#tutorial-title{font-size:18px;font-weight:700;margin-bottom:6px;color:#fff}' +
      '#tutorial-body{font-size:14px;line-height:1.45;color:#b9c8e4;margin-bottom:8px}' +
      '#tutorial-obj{font-size:14px;color:#ffd23f;margin-bottom:10px}' +
      '#tutorial-btns{display:flex;gap:8px}' +
      '#tutorial-btns button{flex:1;padding:10px;border-radius:8px;border:1px solid #39d5e8;' +
      'background:#0b1a33;color:#fff;font-size:14px;cursor:pointer}' +
      '#tutorial-continue{background:#123a5c!important;font-weight:700}' +
      '#tutorial-skip{flex:.6!important;opacity:.75}' +
      '#tutorial-min{flex:.4!important;opacity:.75}' +
      '#tutorial-chip{position:fixed;left:12px;bottom:150px;z-index:10000;padding:8px 12px;' +
      'border-radius:20px;border:1px solid #39d5e8;background:rgba(6,12,26,.9);color:#dfe9ff;' +
      'font-size:13px;cursor:pointer}';
    document.head.appendChild(css);
  }

  function build() {
    if (built) return;
    built = true;
    injectCSS();
    ov = document.createElement('div');
    ov.id = 'tutorial-overlay';
    ov.className = 'hidden';
    ov.innerHTML =
      '<div id="tutorial-card">' +
      '<div id="tutorial-progress"></div>' +
      '<div id="tutorial-title"></div>' +
      '<div id="tutorial-body"></div>' +
      '<div id="tutorial-obj"></div>' +
      '<div id="tutorial-btns">' +
      '<button id="tutorial-continue">CONTINUE</button>' +
      '<button id="tutorial-skip">SKIP</button>' +
      '<button id="tutorial-min" title="minimize">\u2715</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#tutorial-continue').addEventListener('click', function () {
      if (SF.Audio) SF.Audio.ui();
      if (active && stepId() === 'intro') advance();
    });
    ov.querySelector('#tutorial-skip').addEventListener('click', function () {
      if (SF.Audio) SF.Audio.ui();
      skip();
    });
    ov.querySelector('#tutorial-min').addEventListener('click', function () {
      if (SF.Audio) SF.Audio.ui();
      minimize();
    });
    chip = document.createElement('button');
    chip.id = 'tutorial-chip';
    chip.className = 'hidden';
    chip.textContent = '\uD83D\uDCD6 TUTORIAL';
    chip.addEventListener('click', function () {
      if (SF.Audio) SF.Audio.ui();
      restore();
    });
    document.body.appendChild(chip);
  }

  var lastBuyText = '';
  function paint() {
    if (!built) return;
    var s = STEPS[st.step];
    if (!s) return;
    ov.querySelector('#tutorial-progress').textContent =
      'FIRST FLIGHT \u00B7 STEP ' + (st.step + 1) + '/' + STEPS.length;
    ov.querySelector('#tutorial-title').textContent = s.title;
    /* twelve-hour-wave1: the buy step's numbers are live (wallet + ore),
     * so the text stays true while the player sells ore at the dock. */
    var body = s.body, obj = s.obj;
    if (s.id === 'buy') {
      var g = buyGuidance();
      body = g.body; obj = g.obj; lastBuyText = body + '|' + obj;
    }
    ov.querySelector('#tutorial-body').textContent = body;
    ov.querySelector('#tutorial-obj').textContent = '\u25B6 ' + obj;
    ov.querySelector('#tutorial-continue').style.display = s.manual ? '' : 'none';
  }

  function stepId() { return STEPS[st.step] ? STEPS[st.step].id : null; }

  /* ---------- flow ---------- */

  function recordBaseline() {
    try {
      startX = SF.Player.x; startY = SF.Player.y;
      startOre = Math.floor(SF.Player.ore);
      startWeapons = SF.Player.weaponsOwned.length;
    } catch (e) {}
  }

  function start() {
    build();
    active = true; minimized = false;
    st.seen = true; st.step = 0; persist();
    recordBaseline();
    paint();
    ov.classList.remove('hidden');
    chip.classList.add('hidden');
  }

  function skip() {
    active = false;
    st.seen = true; st.done = true; persist();
    if (built) { ov.classList.add('hidden'); chip.classList.add('hidden'); }
    if (window.SF && SF.HUD) SF.HUD.toast('Tutorial skipped — fly free, pilot.');
  }

  function minimize() {
    minimized = true;
    ov.classList.add('hidden');
    chip.classList.remove('hidden');
  }

  function restore() {
    minimized = false;
    chip.classList.add('hidden');
    paint();
    ov.classList.remove('hidden');
  }

  function advance() {
    st.step++;
    if (st.step >= STEPS.length) {
      active = false;
      st.done = true; st.seen = true; persist();
      if (built) { ov.classList.add('hidden'); chip.classList.add('hidden'); }
      /* twelve-hour-wave1: post-tutorial first goal. Reuses the existing
       * tracker waypoint (SF.Game.waypoint, shown by SF.Tracker with an
       * off-system marker) — no new quest system. Only set when nothing
       * else already claims the waypoint (story waypoint, bounty, mission)
       * so an in-progress objective is never clobbered. */
      try {
        var storyWp = null;
        if (window.SF && SF.Story && SF.Story.waypoint) storyWp = SF.Story.waypoint();
        if (!storyWp && window.SF && SF.Game && !SF.Game.waypoint) {
          SF.Game.waypoint = { systemId: 'solace', x: 900, y: 900,
            label: 'The Fall wreck — investigate the signal' };
        }
      } catch (e) {}
      if (window.SF && SF.HUD) SF.HUD.toast('\u2713 First flight complete — next: the Fall wreck ' +
        'in Solace is marked \u2316 on your tracker. Contracts pay at Haven\u2019s Mission Board.');
      if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
      return;
    }
    persist();
    recordBaseline();
    if (!minimized) { paint(); ov.classList.remove('hidden'); }
  }

  function showTip(id) {
    if (st.tips[id]) return;
    st.tips[id] = true; persist();
    /* Tips ride the game's toast: transient, pointer-transparent, never
     * blocks touch controls or other overlays. */
    if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast('\uD83D\uDCA1 ' + TIPS[id]);
  }

  /* ---------- hooks ---------- */

  function onNewGame() {
    if (st.done) return; // returning player: never interrupt the flow
    start();
  }

  function onDocked() {
    showTip('dock');
    if (active && stepId() === 'dock') advance();
  }

  function onJumped() {
    showTip('jump');
    if (active && stepId() === 'jump') advance();
  }

  function hookAll() {
    if (hooked) return;
    if (!window.SF || !SF.Game || !SF.Station) return;
    hooked = true;
    function wrap(obj, name, fn) {
      var orig = obj[name];
      if (typeof orig !== 'function' || orig._tutorialWrapped) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { fn.apply(this, arguments); } catch (e) {}
        return r;
      };
      w._tutorialWrapped = true;
      obj[name] = w;
    }
    wrap(SF.Game, 'newGame', onNewGame);
    wrap(SF.Station, 'dock', onDocked);
    wrap(SF.Game, 'travelTo', onJumped);
    /* The title-screen NEW GAME button calls main.js's closure-local
     * newGame(), not SF.Game.newGame — bind the button too. Deferred so
     * the game's own handler (which resets the player) runs first. */
    var nb = document.getElementById('btn-new');
    if (nb && !nb._tutorialBound) {
      nb._tutorialBound = true;
      nb.addEventListener('click', function () { setTimeout(onNewGame, 500); });
    }
  }

  /* ---------- step polling ---------- */

  function friendlyFiring() {
    try {
      var pool = SF.Projectiles.pool;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].active && pool[i].friendly) return true;
      }
    } catch (e) {}
    return false;
  }

  function tick() {
    hookAll();
    if (!window.SF || !SF.Player || !SF.Game) return;
    // weapon-purchase tip is independent of the walkthrough
    if (tipWeaponBase < 0) { try { tipWeaponBase = SF.Player.weaponsOwned.length; } catch (e) {} }
    try {
      if (tipWeaponBase >= 0 && SF.Player.weaponsOwned.length > tipWeaponBase) {
        tipWeaponBase = SF.Player.weaponsOwned.length;
        showTip('weapon');
      }
    } catch (e) {}
    if (!active || minimized) return;
    var id = stepId();
    if (!id) return;
    /* twelve-hour-wave1: keep the buy step's live numbers fresh while the
     * player sells ore at the dock (repaint only when the text changed). */
    if (id === 'buy' && built) {
      try {
        var gg = buyGuidance();
        if (gg.body + '|' + gg.obj !== lastBuyText) paint();
      } catch (e) {}
    }
    var done = false;
    try {
      if (id === 'fly') {
        var dx = SF.Player.x - startX, dy = SF.Player.y - startY;
        done = Math.sqrt(dx * dx + dy * dy) > 250;
      } else if (id === 'fire') {
        done = friendlyFiring();
      } else if (id === 'mine') {
        done = Math.floor(SF.Player.ore) > startOre;
      } else if (id === 'buy') {
        done = SF.Player.weaponsOwned.length > startWeapons;
      }
      // 'dock' and 'jump' advance via their hooks; 'intro' via CONTINUE
    } catch (e) {}
    if (done) advance();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookAll);
    } else { hookAll(); }
  }
  if (typeof setInterval !== 'undefined') setInterval(tick, 400);

  return {
    active: function () { return active; },
    step: function () { return st.step; },
    stepId: stepId,
    state: function () { return { seen: st.seen, done: st.done, step: st.step, tips: st.tips }; },
    start: start,
    skip: skip,
    _tick: tick // test hook
  };
})();

/* ================= beta2-pressure-tutorial: BASICS page ================
 * SF.Basics: the re-readable basics the 7-step walkthrough cannot be.
 * Diagnosis (see phase REPORT): the walkthrough runs once, on NEW GAME
 * only — once its localStorage flag is done it never re-offers, and
 * there is no button anywhere to reopen it; its copy is touch-first
 * ("Drag the left stick", "Tap CONTINUE") with keyboard keys as
 * parentheticals; and it never mentions panels, surrender hails, or
 * how to explore safely. Rather than re-running a one-shot walkthrough
 * mid-flight, this page states the missing basics in one place and is
 * reachable from the title screen (#btn-basics-title) and the in-flight
 * MENU drawer (#btn-basics-drawer), plus a REPLAY FIRST FLIGHT button
 * that restarts the existing walkthrough via SF.Tutorial.start().
 * The overlay carries the .overlay class, so the game's modal pause
 * (main.js modalBlocking) freezes the sim while it is open — reading
 * cannot get you killed. It is closed on any game state change (a
 * setState wrapper), so it can never strand over a new game. Runtime
 * DOM only, save-neutral: no SAVE_VERSION bump, no save-blob keys. */
SF.Basics = (function () {
  var built = false, ov = null;
  var SECTIONS = [
    { t: 'FLY',
      b: 'Left stick (or WASD) thrusts. Drag anywhere on the right side to aim and fire in any direction. The FIRE button (or Space) shoots straight ahead.' },
    { t: 'PANELS',
      b: 'M opens the star map, Q the quest log, C the codex. Every panel has a CLOSE button, and opening one pauses the game — read without getting shot.' },
    { t: 'SURRENDER HAILS',
      b: 'A crippled pirate may beg for mercy. The game pauses while you choose. Accept and it drops its cargo and flees (+2 karma). Refuse or destroy and it fights on.' },
    { t: 'EXPLORE SAFELY',
      b: 'Patrols show up regularly, but Solace is the calm system. Outmatched? Fly away — pirates that cannot keep up break off and leave. Near Haven Dock, rookie pilots sit inside a safe bubble (dashed ring) where unprovoked hostiles hold their fire. Docking saves your game.' }
  ];
  function build() {
    if (built) return;
    built = true;
    ov = document.createElement('div');
    ov.id = 'overlay-basics';
    ov.className = 'overlay hidden';
    var html = '<div class="panel"><h2>\uD83D\uDCD6 BASICS</h2>';
    for (var i = 0; i < SECTIONS.length; i++) {
      html += '<h3 style="margin:10px 0 2px;color:#fff">' + SECTIONS[i].t + '</h3>' +
        '<p style="margin:0 0 8px;color:#b9c8e4;font-size:14px;line-height:1.45">' +
        SECTIONS[i].b + '</p>';
    }
    html += '<button id="btn-basics-replay" class="btn small ui-block">REPLAY FIRST FLIGHT</button> ' +
      '<button id="btn-basics-close" class="btn big ui-block">CLOSE</button></div>';
    ov.innerHTML = html;
    document.body.appendChild(ov);
    ov.querySelector('#btn-basics-close').addEventListener('click', function () { close(); });
    ov.querySelector('#btn-basics-replay').addEventListener('click', function () {
      close();
      try { if (window.SF && SF.Tutorial) SF.Tutorial.start(); } catch (e) {}
    });
  }
  function open() {
    build();
    ov.classList.remove('hidden');
  }
  function close() {
    if (ov) ov.classList.add('hidden');
  }
  function isOpen() {
    return !!(ov && !ov.classList.contains('hidden'));
  }
  function install() {
    ['btn-basics-title', 'btn-basics-drawer'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b && !b._basicsWired) {
        b._basicsWired = true;
        b.addEventListener('click', function () {
          if (window.SF && SF.Audio) SF.Audio.unlock();
          open();
        });
      }
    });
    // never strand over a state change (e.g. NEW GAME from the title)
    if (window.SF && SF.Game && typeof SF.Game.setState === 'function' &&
        !SF.Game.setState._basicsWrapped) {
      var orig = SF.Game.setState;
      var w = function () { close(); return orig.apply(this, arguments); };
      w._basicsWrapped = true;
      SF.Game.setState = w;
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else { install(); }
  }
  return {
    open: open,
    close: close,
    isOpen: isOpen,
    sections: function () { return SECTIONS; }
  };
})();

/* ================= twelve-hour-wave1: Haven safe-bubble watch ==========
 * The Haven safe bubble (radius 650 around Haven Dock, rookie Solace only)
 * was invisible: protection ended silently at the edge. This module is the
 * toast half of the fix (the ring half is one dashed arc in main.js's
 * world draw, rookie-Solace only). A 400 ms poll — no per-frame work, no
 * new draw calls — tracks havenSafeActive() transitions and tells the
 * player in plain words: leaving the bubble, re-entering it, and rookie
 * grace ending at Lv3. The first observation only arms the state (no toast
 * on load inside the bubble); toasts fire only on transitions. Session
 * flags only, nothing serialized, no save change.
 */
SF.HavenWatch = (function () {
  var prevSafe = null, graceEndedToasted = false;

  function tick() {
    try {
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
      if (!SF.Player || !SF.Enemies || !SF.Enemies.havenSafeActive) return;
      if (SF.Game.systemId !== 'solace') { prevSafe = null; return; }
      var safe = !!SF.Enemies.havenSafeActive(SF.Player);
      if (prevSafe === null) { prevSafe = safe; return; }
      if (safe === prevSafe) return;
      prevSafe = safe;
      if (!SF.HUD || !SF.HUD.toast) return;
      if (safe) {
        SF.HUD.toast('\uD83D\uDEE1\uFE0F Back inside Haven\u2019s safe zone — patrols hold fire unless provoked.');
      } else {
        var rf = null;
        try { rf = SF.Enemies.rookieFactor('solace'); } catch (e) {}
        if (rf && !rf.active && !graceEndedToasted) {
          graceEndedToasted = true;
          SF.HUD.toast('Rookie grace has ended (Lv3) — patrols now hit at full damage, everywhere.');
        } else {
          SF.HUD.toast('\u26A0\uFE0F You left Haven\u2019s safe zone — unprovoked patrols will now engage.');
        }
      }
    } catch (e) { /* watch must never break the game loop */ }
  }

  if (typeof setInterval !== 'undefined') setInterval(tick, 400);

  return {
    state: function () { return { prevSafe: prevSafe, graceEndedToasted: graceEndedToasted }; },
    _tick: tick // test hook
  };
})();

/* ================= boss-encounters phase (2026-10-19) =================
 * SF.BossBar: capital-ship health bar. Runtime-created DOM (index.html is
 * outside this phase's file scope), painted once per frame from
 * SF.HUD.update. Shows while any boss is alive in the current system.
 *
 * hud-declutter-1 (2026-10-22): user screenshots showed this bar as a huge
 * full-width orange slab at top:46px with z-index 9000 — ON TOP of the
 * raid banner (SF.RaidBar, js/station.js: top:88px, also z-9000) and still
 * painted over the SHIP LOST game-over modal, because nothing hid it once
 * HUD.update stopped running. Fixes:
 *  - z-index 21 (inside the HUD layer: #hud is z-20, overlays are z-50),
 *    so a modal ALWAYS covers the bar.
 *  - Fixed slot BELOW the whole banner stack: raid bar ~88-134px,
 *    #hud-tracker at 178-~208px, boss bar at top:216px. The three can
 *    never overlap. Width capped at min(420px, 60vw), track 8px.
 *  - Hidden whenever SF.Game.state !== 'PLAYING', even with a boss
 *    alive; SF.HudDeclutter (end of this file) also hides it on every
 *    setState/showHud(false) transition, since HUD.update does not run
 *    outside PLAYING.
 */
SF.BossBar = (function () {
  var bar = null, fill = null, label = null;
  var SLOT_TOP = 216; // CSS px; below #hud-tracker (178 + ~30 tall)

  function build() {
    if (bar) return;
    var css = document.createElement('style');
    css.id = 'bossbar-css';
    css.textContent =
      '#boss-bar{position:fixed;top:calc(216px + env(safe-area-inset-top));' +
      'left:50%;transform:translateX(-50%);' +
      'width:min(420px,60vw);z-index:21;pointer-events:none}' +
      '#boss-bar .blabel{text-align:center;font:bold 12px monospace;color:#ff8d7a;' +
      'letter-spacing:2px;text-shadow:0 0 8px #000;margin-bottom:2px}' +
      '#boss-bar .btrack{height:8px;background:rgba(10,4,4,.75);' +
      'border:1px solid #ff5e3a;border-radius:4px;overflow:hidden}' +
      '#boss-bar .bfill{height:100%;width:100%;' +
      'background:linear-gradient(90deg,#ff2e1f,#ff8c2e);transform-origin:left center}';
    document.head.appendChild(css);
    bar = document.createElement('div');
    bar.id = 'boss-bar';
    bar.className = 'hidden';
    bar.innerHTML = '<div class="blabel"></div><div class="btrack"><div class="bfill"></div></div>';
    document.body.appendChild(bar);
    label = bar.querySelector('.blabel');
    fill = bar.querySelector('.bfill');
  }

  function hide() { build(); bar.classList.add('hidden'); }

  return {
    SLOT_TOP: SLOT_TOP,
    hide: hide,
    isVisible: function () { build(); return !bar.classList.contains('hidden'); },
    rect: function () {
      build();
      if (bar.classList.contains('hidden')) return null;
      var r = bar.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
               width: r.width, height: r.height };
    },
    update: function () {
      build();
      // hud-declutter-1: never render outside PLAYING (title / docked /
      // starmap / game-over), even while a boss is alive.
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') {
        bar.classList.add('hidden');
        return;
      }
      var boss = null;
      try {
        var l = SF.Enemies.list;
        for (var i = 0; i < l.length; i++) if (l[i].boss) { boss = l[i]; break; }
      } catch (e) {}
      if (!boss) { bar.classList.add('hidden'); return; }
      bar.classList.remove('hidden');
      var f = Math.max(0, boss.hp / boss.maxHp);
      label.textContent = '\u26a0 ' + boss.bossDef.title + ' \u26a0';
      fill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
    }
  };
})();

/* ================= quest-tracker phase (2026-10-19) =================
 * SF.Tracker: on-screen objective tracker.
 *
 * Objective markers for active quest / bounty / waypoint targets:
 *  - offscreen target -> edge-of-screen arrow pointing at it + distance readout
 *  - onscreen target  -> small in-world rotating diamond marker + label + distance
 *  - compact tracker line in the HUD listing the current objective text
 *
 * Sources (priority order): escort ambush in progress > active quest-board /
 * companion quest > active bounty > story waypoint > SF.Game.waypoint
 * (bounty/homebase) > un-cleared dungeon in the current system.
 *
 * Save-neutral: no save fields touched, no SAVE_VERSION bump.
 *
 * Camera: camX/camY are closure-local in main.js, so the tracker replicates
 * the same follow-lerp (cam += (p - vw/2 - cam) * min(1, 6*dt)). Exact in
 * steady state; converges within ~1s after fast movement. Markers draw on a
 * dedicated overlay canvas (z-index 15, pointer-transparent) driven from
 * SF.HUD.update — no main.js edits needed.
 */
SF.Tracker = (function () {
  'use strict';

  var cv = null, g = null, lineEl = null;
  var lineShownAt = 0;
  var BOUNTY_LINE_MS = 8000; // bounty tracker line auto-hides this long after its text last changed
  var rcx = null, rcy = null, lastSys = null, lastT = 0;
  var fireKeepOut = null, fireKeepOutT = 0;
  var dpr = 1;

  var COLORS = {
    quest: '#ffd23f', bounty: '#ff5e3a', waypoint: '#ff4fd8',
    dungeon: '#b48cff', danger: '#ff3b30'
  };
  var TITLES = {
    kill: '☠ Kill Contract', mining: '⛏ Mining Claim',
    supply: '📦 Supply Run', escort: '🛡 Escort Duty'
  };

  /* ---------------- DOM / canvas ---------------- */

  function ensureDom() {
    if (lineEl) return;
    var hud = document.getElementById('hud');
    lineEl = document.createElement('div');
    lineEl.id = 'hud-tracker';
    lineEl.className = 'hidden';
    if (hud) hud.appendChild(lineEl);

    cv = document.createElement('canvas');
    cv.id = 'tracker-overlay';
    cv.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;';
    document.body.appendChild(cv);
    g = cv.getContext('2d');
    sizeCanvas();
  }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = Math.floor(vw * dpr), H = Math.floor(vh * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function uiScale() {
    var vw = window.innerWidth;
    return vw <= 480 ? 0.78 : (vw <= 700 ? 0.88 : 1);
  }

  /* ---------------- world queries ---------------- */

  function enemyList() {
    var l = SF.Enemies.list;
    return (typeof l === 'function') ? l() : (l || []);
  }

  function nearestEnemy(pred) {
    var p = SF.Player, best = null, bd = Infinity, i, e, d;
    var l = enemyList();
    for (i = 0; i < l.length; i++) {
      e = l[i];
      if (!e || e.dead) continue;
      if (pred && !pred(e)) continue;
      d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function salvageCount() {
    var inv = SF.Player.partInventory || {}, n = 0, k;
    for (k in inv) n += inv[k];
    return n;
  }

  function sysName(id) {
    var s = SF.SYSTEM_BY_ID[id];
    return s ? s.name : id;
  }

  /* quest.station = 'systemId:Label'; resolve to a same-system position,
   * or { offSystem: true, sys } when the player is elsewhere. */
  function stationPosFor(stationStr) {
    var parts = (stationStr || '').split(':');
    var sys = parts[0], label = parts[1];
    if (!sys) return null;
    if (sys !== SF.Game.systemId) return { offSystem: true, sys: sys };
    var sts = (SF.Station && SF.Station.allStations) ? SF.Station.allStations(sys) : [];
    for (var i = 0; i < sts.length; i++) {
      if (sts[i].name === label) return { x: sts[i].x, y: sts[i].y };
    }
    var sp = SF.Station.stationPos(sys);
    return sp ? { x: sp.x, y: sp.y } : null;
  }

  function questTitle(q) { return q.name || TITLES[q.type] || 'Contract'; }

  function questObjective(q) {
    var t = questTitle(q);
    var stationName = (q.station || '').split(':')[1] || 'station';
    var done;
    if (q.type === 'kill' || q.type === 'escort') done = q.progress >= q.n;
    else if (q.type === 'mining') done = SF.Player.ore >= q.n;
    else if (q.type === 'supply') done = salvageCount() >= q.n;
    else done = false;

    /* escort ambush in progress: point at the raiders */
    /* hud-dup-fix: every objective also carries a SHORT `label` for the
     * in-world marker (paint() used to draw the full `text` sentence at
     * the target AND in the #hud-tracker pill — the same sentence twice
     * on screen, overlapping prompts/labels: user recording 2026-10-23).
     * The pill keeps the full text; the marker draws the label only.
     * `enemy` (when the objective has a concrete target ship) lets
     * paint() defer to SF.TargetLock's readout for that same ship. */
    if (q.state === 'ambush') {
      var amb = nearestEnemy(function (e) { return e.questOid; });
      return {
        text: '🛡 Escort — survive the ambush!', color: COLORS.danger,
        label: '🛡 Escort Ambush', enemy: amb || null,
        x: amb ? amb.x : null, y: amb ? amb.y : null
      };
    }
    /* objective complete: point at the turn-in station */
    if (done) {
      var sp = stationPosFor(q.station);
      if (!sp) return { text: t + ' — return to ' + stationName, color: COLORS.quest, label: t };
      if (sp.offSystem)
        return { text: t + ' — return to ' + stationName + ' (' + sysName(sp.sys) + ')',
                 color: COLORS.quest, offSystem: true, label: t };
      return { text: t + ' — return to ' + stationName, color: COLORS.quest,
               label: t, x: sp.x, y: sp.y };
    }
    if (q.type === 'kill') {
      var tgt = nearestEnemy();
      return {
        text: t + ' — hostiles ' + Math.min(q.progress, q.n) + '/' + q.n,
        color: COLORS.quest, label: t, enemy: tgt || null,
        x: tgt ? tgt.x : null, y: tgt ? tgt.y : null
      };
    }
    if (q.type === 'mining')
      return { text: t + ' — deliver ' + q.n + ' ore to ' + stationName, color: COLORS.quest, label: t };
    if (q.type === 'supply')
      return { text: t + ' — ' + salvageCount() + '/' + q.n + ' salvage → ' + stationName,
               color: COLORS.quest, label: t };
    if (q.type === 'escort')
      return { text: '🛡 Escort — undock from ' + stationName + ' to start', color: COLORS.quest, label: t };
    return { text: t + ' — ' + Math.min(q.progress, q.n) + '/' + q.n, color: COLORS.quest, label: t };
  }

  function bountyObjective() {
    if (!window.SF || !SF.Bounty) return null;
    var b;
    try { b = SF.Bounty.active(); } catch (e) { return null; }
    if (!b || b.state !== 'active') return null;
    var tgt = nearestEnemy(function (e) { return e.bountyId === b.id; });
    if (tgt)
      return { text: '☠ Bounty: ' + b.name + ' — wanted, ' +
               Math.floor(b.reward).toLocaleString('en-US') + 'cr',
               color: COLORS.bounty, x: tgt.x, y: tgt.y, kind: 'bounty',
               label: '☠ ' + b.name, enemy: tgt };
    /* not spawned yet: fall back to the bounty waypoint (gameplay.js) */
    var wp = SF.Game.waypoint;
    if (wp && wp.label === '☠ ' + b.name) {
      if (wp.systemId !== SF.Game.systemId)
        return { text: '☠ Bounty: ' + b.name + ' — last seen in ' + sysName(wp.systemId),
                 color: COLORS.bounty, offSystem: true, kind: 'bounty' };
      return { text: '☠ Bounty: ' + b.name + ' — closing on last known position',
               color: COLORS.bounty, x: wp.x, y: wp.y, kind: 'bounty' };
    }
    /* waypoint lost (e.g. after a save load — accept() is not re-run):
     * the bounty record itself still knows its home system. */
    if (b.system && b.system !== SF.Game.systemId)
      return { text: '☠ Bounty: ' + b.name + ' — last seen in ' + sysName(b.system),
               color: COLORS.bounty, offSystem: true, kind: 'bounty' };
    return { text: '☠ Bounty: ' + b.name + ' — ' +
             Math.floor(b.reward).toLocaleString('en-US') + 'cr', color: COLORS.bounty, kind: 'bounty' };
  }

  function waypointObjective() {
    /* story-campaign waypoint first */
    var sw = null;
    try { if (window.SF && SF.Story && SF.Story.waypoint) sw = SF.Story.waypoint(); } catch (e) {}
    if (sw && sw.systemId === SF.Game.systemId)
      return { text: '⌖ ' + sw.label, color: COLORS.waypoint, x: sw.x, y: sw.y, label: sw.label };
    if (sw) {
      /* open-space-1: cross-region distance in the galaxy frame, so the
       * arrow's target stays meaningful until you cross into its region. */
      var swD = '';
      try {
        if (window.SF && SF.Space && SF.Player)
          swD = ' · ' + Math.floor(SF.Space.absDist(SF.Game.systemId, SF.Player.x, SF.Player.y, sw.systemId, sw.x, sw.y)).toLocaleString('en-US') + 'u';
      } catch (e) {}
      return { text: '⌖ ' + sw.label + ' (' + sysName(sw.systemId) + ')' + swD,
               color: COLORS.waypoint, offSystem: true, label: sw.label };
    }
    /* bounty / homebase waypoint */
    var wp = SF.Game.waypoint;
    if (wp) {
      if (wp.systemId !== SF.Game.systemId) {
        var wpD = '';
        try {
          if (window.SF && SF.Space && SF.Player)
            wpD = ' · ' + Math.floor(SF.Space.absDist(SF.Game.systemId, SF.Player.x, SF.Player.y, wp.systemId, wp.x, wp.y)).toLocaleString('en-US') + 'u';
        } catch (e) {}
        return { text: '⌖ ' + (wp.label || 'Waypoint') + ' (' + sysName(wp.systemId) + ')' + wpD,
                 color: COLORS.waypoint, offSystem: true, label: wp.label || 'Waypoint' };
      }
      return { text: '⌖ ' + (wp.label || 'Waypoint'), color: COLORS.waypoint,
               label: wp.label || 'Waypoint', x: wp.x, y: wp.y };
    }
    return null;
  }

  function dungeonCleared() {
    try {
      var s = SF.Player.secretsState;
      return !!(s && s.dungeon && s.dungeon.cleared);
    } catch (e) { return true; }
  }

  function dungeonObjective() {
    if (!window.SF || !SF.DUNGEONS || dungeonCleared()) return null;
    for (var i = 0; i < SF.DUNGEONS.length; i++) {
      var dg = SF.DUNGEONS[i];
      if (dg.systemId === SF.Game.systemId)
        return { text: '☠ The Hollow Cathedral', color: COLORS.dungeon,
                 label: '☠ The Hollow Cathedral', x: dg.x, y: dg.y };
    }
    return null;
  }

  /* ---------------- public ---------------- */

  return {
    /* Resolve the current objective: {text, x, y, color, offSystem} or null.
     * x/y null = text-only objective (no spatial target). */
    currentObjective: function () {
      if (!window.SF || !SF.Player || !SF.Game) return null;
      try {
        var act = (SF.Player.questState && SF.Player.questState.active) || [];
        var i, q;
        for (i = 0; i < act.length; i++) {
          if (act[i] && act[i].state === 'ambush') return questObjective(act[i]);
        }
        for (i = 0; i < act.length; i++) {
          q = act[i];
          if (q && q.state === 'active') return questObjective(q);
        }
        var b = bountyObjective();
        if (b) return b;
        var w = waypointObjective();
        if (w) return w;
        return dungeonObjective();
      } catch (e) { return null; }
    },

    /* test/debug hook: screen-space placement for the current objective */
    _debug: function () {
      var obj = this.currentObjective();
      if (!obj || obj.x == null) return { objective: obj, screen: null, offscreen: null };
      var vw = window.innerWidth, vh = window.innerHeight;
      var sx = obj.x - rcx, sy = obj.y - rcy;
      var m = 64;
      return {
        objective: { text: obj.text, color: obj.color, offSystem: !!obj.offSystem },
        screen: { x: Math.round(sx), y: Math.round(sy) },
        offscreen: !(sx > m && sx < vw - m && sy > m && sy < vh - m)
      };
    },

    paint: function () {
      if (SF.Game.state !== 'PLAYING' || !SF.Player) {
        if (lineEl) lineEl.classList.add('hidden');
        if (g) g.clearRect(0, 0, window.innerWidth, window.innerHeight);
        return;
      }
      ensureDom();
      sizeCanvas();

      var obj = this.currentObjective();

      /* tracker line. Bounty lines are reminders, not fixtures
       * (user playtest 2026-10-22: "the yellow bounty bar is
       * persistent"): a bounty line shows when its text changes and
       * auto-hides BOUNTY_LINE_MS later; any update (target spawned,
       * system hint changed) re-shows it. The spatial marker painted
       * below is unaffected. Quest/story lines stay pinned — their
       * text changes as you progress. */
      if (!obj || !obj.text) { lineEl.classList.add('hidden'); }
      else {
        if (lineEl._t !== obj.text) {
          lineEl._t = obj.text;
          lineEl.textContent = '◎ ' + obj.text;
          lineShownAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        }
        var lineNow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        if (obj.kind === 'bounty' && lineNow - lineShownAt > BOUNTY_LINE_MS)
          lineEl.classList.add('hidden');
        else
          lineEl.classList.remove('hidden');
      }

      /* camera follow (replicates main.js lerp) */
      var vw = window.innerWidth, vh = window.innerHeight;
      var sys = SF.Game.systemId;
      if (sys !== lastSys) { rcx = null; lastSys = sys; }
      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016;
      lastT = now;
      if (rcx === null) { rcx = SF.Player.x - vw / 2; rcy = SF.Player.y - vh / 2; }
      var k = Math.min(1, 6 * dt);
      rcx += (SF.Player.x - vw / 2 - rcx) * k;
      rcy += (SF.Player.y - vh / 2 - rcy) * k;

      /* markers */
      g.clearRect(0, 0, vw, vh);
      if (!obj || obj.x == null || obj.offSystem) return;
      var sx = obj.x - rcx, sy = obj.y - rcy;
      var dist = Math.hypot(obj.x - SF.Player.x, obj.y - SF.Player.y);
      var dTxt = dist >= 1000 ? (dist / 1000).toFixed(1) + 'km' : Math.round(dist) + 'm';
      var us = uiScale();
      var m = 64 * us;
      var t = now / 1000;

      /* hud-dup-fix: the in-world marker draws the SHORT label only —
       * the full objective sentence lives in the #hud-tracker pill and
       * nowhere else. And when SF.TargetLock is locked onto the very
       * ship this objective points at, its reticle already shows name +
       * hull + distance: the tracker then skips its own distance (and,
       * offscreen, its whole edge arrow) so the target never carries
       * two stacked distance readouts (user recording 2026-10-23). */
      var markerLabel = obj.label || obj.text;
      var sameTarget = false;
      try {
        sameTarget = !!(obj.enemy && window.SF && SF.TargetLock &&
          typeof SF.TargetLock.current === 'function' &&
          SF.TargetLock.current() === obj.enemy);
      } catch (e) { sameTarget = false; }

      if (sx > m && sx < vw - m && sy > m && sy < vh - m) {
        /* onscreen: small in-world rotating diamond + label + distance */
        var pulse = 0.5 + 0.5 * Math.sin(t * 4);
        var r = (15 + pulse * 5) * us;
        g.save();
        g.translate(sx, sy);
        g.rotate(Math.PI / 4 + t * 0.9);
        g.strokeStyle = obj.color;
        g.globalAlpha = 0.65 + 0.35 * pulse;
        g.lineWidth = 2.5 * us;
        g.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
        g.restore();
        g.globalAlpha = 1;
        g.fillStyle = obj.color;
        g.font = 'bold ' + Math.round(13 * us) + 'px monospace';
        g.textAlign = 'center';
        /* hud-sprite-improve: near the top edge the label would paint
         * straight across the top-right reactor stance tabs — flip the
         * label stack below the diamond when there isn't room above. */
        if (sy - (r + 14 * us) > 100 * us) {
          g.fillText(markerLabel, sx, sy - (r + 14 * us));
          if (!sameTarget) {
            g.fillStyle = '#dfe9ff';
            g.font = Math.round(12 * us) + 'px monospace';
            g.fillText(dTxt, sx, sy + (r + 20 * us));
          }
        } else {
          g.fillText(markerLabel, sx, sy + (r + 20 * us));
          if (!sameTarget) {
            g.fillStyle = '#dfe9ff';
            g.font = Math.round(12 * us) + 'px monospace';
            g.fillText(dTxt, sx, sy + (r + 36 * us));
          }
        }
      } else {
        /* hud-dup-fix: TargetLock's edge arrow (name + distance) already
         * covers this exact ship — drawing the tracker arrow too stacks
         * two indicators at the same edge point. */
        if (sameTarget) return;
        /* offscreen: edge arrow pointing at the target + distance */
        var cx = vw / 2, cy = vh / 2;
        var ang = Math.atan2(sy - cy, sx - cx);
        var px = intersectRect(cx, cy, ang, vw, vh, m);
        /* hud-sprite-improve: keep the arrow out of the top-right
         * reactor stance tabs and the bottom-right FIRE button. */
        var wr = (window.SF && SF.Player && SF.Player.widgetRect) ? SF.Player.widgetRect() : null;
        if (wr && px.y <= m + 1 && px.x > wr.x - 20 * us) {
          px.y = Math.max(px.y, wr.y + wr.h + 16 * us);
        }
        if (px.y >= vh - m - 1) {
          if (!fireKeepOut || now - fireKeepOutT > 500) {
            var fb = document.getElementById('btn-fire');
            var fbr = fb ? fb.getBoundingClientRect() : null;
            fireKeepOut = (fbr && fbr.width) ? { x: fbr.x } : null;
            fireKeepOutT = now;
          }
          if (fireKeepOut && px.x > fireKeepOut.x - 20 * us) {
            px.x = Math.min(px.x, fireKeepOut.x - 30 * us);
          }
        }
        g.save();
        g.translate(px.x, px.y);
        g.rotate(ang);
        var bob = Math.sin(t * 5) * 4 * us;
        g.translate(bob, 0);
        var s = 16 * us;
        g.fillStyle = obj.color;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(s, 0); g.lineTo(-s * 0.6, -s * 0.7); g.lineTo(-s * 0.6, s * 0.7);
        g.closePath(); g.fill(); g.stroke();
        g.restore();
        /* distance readout just inside the arrow */
        g.fillStyle = '#dfe9ff';
        g.font = Math.round(12 * us) + 'px monospace';
        g.textAlign = 'center';
        var tx = px.x - Math.cos(ang) * 34 * us;
        var ty = px.y - Math.sin(ang) * 34 * us + 4;
        g.fillText(dTxt, tx, ty);
      }
    },

    resetCamera: function () { rcx = null; lastSys = null; }
  };

  /* intersect a ray from (cx,cy) at angle ang with the inset rect */
  function intersectRect(cx, cy, ang, vw, vh, m) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var tx = dx > 0 ? (vw - m - cx) / dx : (dx < 0 ? (m - cx) / dx : Infinity);
    var ty = dy > 0 ? (vh - m - cy) / dy : (dy < 0 ? (m - cy) / dy : Infinity);
    var t = Math.min(tx, ty);
    if (!isFinite(t) || t < 0) t = 0;
    return { x: cx + dx * t, y: cy + dy * t };
  }
})();

/* ================= death-legacy-retry phase (2026-10-19) =================
 * Ship insurance buyback on the gameover screen.
 *
 * Runtime-created DOM (index.html is outside this phase's file scope), wired
 * from SF.HUD.showDeathOffer() which main.js calls in onPlayerDeath().
 * Strictly additive + idempotent; save-neutral.
 */
window.SF = window.SF || {};

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function ensureDeathUI() {
    var ov = $('overlay-gameover');
    if (!ov) return null;
    var box = $('gameover-insurance');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'gameover-insurance';
    box.style.cssText = 'margin:10px 0;padding:10px;border:1px solid #ffd23f;' +
      'border-radius:8px;background:rgba(40,30,4,.6);text-align:left;font-size:14px';
    var panel = ov.querySelector('.panel');
    var resp = $('btn-respawn');
    if (panel && resp) panel.insertBefore(box, resp);
    else if (panel) panel.appendChild(box);
    return box;
  }

  function showDeathOffer() {
    var box = ensureDeathUI();
    if (!box) return;
    var off = (window.SF && SF.Legacy) ? SF.Legacy.offer() : null;
    if (!off) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    if (off.insured) {
      box.innerHTML = '<div style="color:#3ddc5f;font-weight:bold">' +
        'INSURED — your lost credits will be refunded on respawn.</div>';
      return;
    }
    var affordable = SF.Player.credits >= off.cost;
    var under = off.faction ? off.faction.name + ' (' +
      (off.standing >= 0 ? '+' : '') + off.standing + ')' : 'no underwriter';
    box.innerHTML =
      '<div style="color:#ffd23f;font-weight:bold;margin-bottom:4px">SHIP INSURANCE</div>' +
      '<div class="dim" style="margin-bottom:8px">Buy back the lost <b>' +
      off.lost.toLocaleString('en-US') + '</b>cr for a <b>' +
      off.cost.toLocaleString('en-US') + '</b>cr premium (' + off.pct +
      '%) — underwritten by ' + under + '. Better standing = cheaper premium.</div>' +
      '<button id="btn-buyback" class="btn ui-block"' +
      (affordable ? '' : ' disabled') + '>BUY BACK ' +
      off.lost.toLocaleString('en-US') + 'cr · ' +
      off.cost.toLocaleString('en-US') + 'cr</button>' +
      (affordable ? '' : '<div class="dim">not enough credits for the premium</div>');
    var btn = $('btn-buyback');
    if (btn && !btn._legacyBound) {
      btn._legacyBound = true;
      btn.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.unlock();
        if (window.SF && SF.Legacy && SF.Legacy.buyInsurance()) {
          if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
          showDeathOffer(); // repaint -> insured state
        } else if (window.SF && SF.Audio && SF.Audio.deny) {
          SF.Audio.deny();
        }
      });
    }
  }

  if (window.SF && SF.HUD) SF.HUD.showDeathOffer = showDeathOffer;
})();

/* ================= starmap-waypoints phase (2026-10-20) =================
 * SF.NavMarks: player-set star-map waypoint + heading-hold autopilot.
 *
 * - Open the star map [M], tap "◎ WAYPOINT", then tap anywhere on the map to
 *   drop a waypoint in the CURRENT system (tap % -> world coords). Tap the
 *   button again (now "⌖ CLEAR") to remove it.
 * - Marker renders in-world on a dedicated overlay canvas (pulsing cyan
 *   diamond + km/m distance readout; edge arrow when offscreen) and on the
 *   minimap (cyan diamond).
 * - "🧭 HOLD [H]" HUD button / H key: heading-hold. While engaged and the
 *   waypoint is in the current system, the player's move vector is gently
 *   rotated toward the waypoint bearing (max TURN_RATE rad/s). Throttle and
 *   braking stay 100% manual — the assist never injects thrust, it only
 *   steers an input the player is already giving. Disengages on combat
 *   damage (SF.Player.takeDamage) or a manual hard turn (strong input >60°
 *   off the waypoint bearing after a short grace period).
 * - Arrival within 300u: ping (SF.Audio.questAccept) + toast, marker clears.
 * - Waypoint persists across system jumps (steers only when in-system);
 *   cleared on dock and on new game. Purely runtime — save-neutral, no
 *   SAVE_VERSION bump.
 *
 * Integration is strictly additive + idempotent: wraps SF.HUD.update,
 * SF.HUD.drawMinimap, SF.Input.poll, SF.Player.takeDamage, SF.Station.dock,
 * SF.Starmap.open/close, and (deferred — main.js loads after hud.js)
 * SF.Game.newGame/travelTo. Runtime-created DOM only (starmap arm button,
 * HOLD button, overlay canvas); index.html, css/ and main.js untouched.
 */
window.SF = window.SF || {};

SF.NavMarks = (function () {
  'use strict';

  var ARRIVE_DIST = 300;      // arrival radius (world units)
  var TURN_RATE = 1.2;        // heading-hold max turn rate (rad/s) — gentle
  var MAX_OFFSET = 1.2;       // max heading correction the assist may apply (rad)
  var HARD_TURN = 1.05;       // input deviating more than this (~60°) = manual override
  var HOLD_GRACE_MS = 750;    // grace after engaging before hard-turn can disengage
  var COLOR = '#39d5e8';      // cyan — distinct from the magenta quest waypoint

  var mark = null;            // {systemId, x, y, setAt} | null
  var hold = false;           // heading-hold engaged
  var holdEngagedAt = 0;
  var steerOffset = 0;        // persistent heading correction (rad), slewed at TURN_RATE
  var armed = false;          // star-map waypoint-drop mode
  var hooked = false;

  var cv = null, g = null, dpr = 1;
  var holdBtn = null;
  var rcx = null, rcy = null, lastSys = null, lastT = 0;
  var lastPollT = 0;

  /* ---------------- helpers ---------------- */

  function nowMs() {
    return (typeof performance !== 'undefined') ? performance.now() : Date.now();
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function fmtDist(d) {
    return d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm';
  }

  function sysName(id) {
    var s = window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id];
    return s ? s.name : id;
  }

  function toast(msg) {
    try { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
  }

  function distToMark() {
    if (!mark || !window.SF || !SF.Player) return Infinity;
    return Math.hypot(mark.x - SF.Player.x, mark.y - SF.Player.y);
  }

  function markInSystem() {
    return !!(mark && window.SF && SF.Game && mark.systemId === SF.Game.systemId);
  }

  /* ---------------- state ---------------- */

  function setMark(systemId, x, y) {
    var ws = (window.SF && SF.CONFIG && SF.CONFIG.worldSize) || 4200;
    mark = {
      systemId: systemId,
      x: clamp(x, 50, ws - 50),
      y: clamp(y, 50, ws - 50),
      setAt: Date.now()
    };
    paintHoldButton();
    return mark;
  }

  function clearMark() {
    mark = null;
    hold = false;
    steerOffset = 0;
    armed = false;
    var wrap = document.getElementById('starmap-systems');
    if (wrap) wrap.classList.remove('arming');
    paintHoldButton();
    paintArmButton();
  }

  function disengage(reason) {
    if (!hold) return;
    hold = false;
    holdEngagedAt = 0;
    steerOffset = 0;
    paintHoldButton();
    toast('⚠ Heading hold off — ' + reason);
  }

  function toggleHold() {
    if (!window.SF || !SF.Game || !SF.Player) return false;
    if (SF.Game.state !== 'PLAYING') return false;
    if (!mark) {
      toast('No waypoint — open the star map [M] to set one');
      if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny();
      return false;
    }
    hold = !hold;
    holdEngagedAt = hold ? nowMs() : 0;
    if (!hold) steerOffset = 0;
    if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
    toast(hold ? '🧭 Heading hold engaged → ' + fmtDist(distToMark())
               : '🧭 Heading hold off');
    paintHoldButton();
    return hold;
  }

  function arrive() {
    var d = distToMark();
    clearMark();
    try {
      if (window.SF && SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
    } catch (e) {}
    toast('⌖ Waypoint reached' + (d < Infinity ? ' — ' + fmtDist(d) : ''));
  }

  /* ---------------- heading-hold assist (input level) ----------------
   * Runs inside the wrapped SF.Input.poll, after the original poll has
   * merged touch + keyboard. Steers ONLY: slews a persistent heading
   * correction (steerOffset) toward the needed deflection at TURN_RATE, then
   * applies it to the player's move vector. The raw input is rebuilt from
   * keys every poll, so the correction must accumulate in module state —
   * rotating the per-poll vector directly never accumulates. Never injects
   * thrust: with no player input the offset just relaxes toward zero.
   */
  function holdAssist(self) {
    if (!hold || !markInSystem()) { steerOffset = 0; return; }
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') { steerOffset = 0; return; }
    var p = SF.Player;
    if (!p || !p.alive || (p.isAdrift && p.isAdrift())) { steerOffset = 0; return; }
    var dx = mark.x - p.x, dy = mark.y - p.y;
    var want = Math.atan2(dy, dx);
    var mx = self.mx, my = self.my;
    var mag = Math.hypot(mx, my);
    /* no thrust input: relax the correction, never drive the ship */
    if (mag < 0.05) { steerOffset *= 0.9; return; }
    var cur = Math.atan2(my, mx);
    var d = angDiff(want, cur);
    /* manual hard turn: strong input far off the waypoint bearing */
    if (mag > 0.5 && nowMs() - holdEngagedAt > HOLD_GRACE_MS) {
      if (Math.abs(d) > HARD_TURN) {
        steerOffset = 0;
        disengage('manual override');
        return;
      }
    }
    /* slew the correction toward the needed deflection at TURN_RATE */
    var dtp = lastPollT ? Math.min(0.1, (nowMs() - lastPollT) / 1000) : 0.016;
    var need = clamp(d, -MAX_OFFSET, MAX_OFFSET);
    var delta = clamp(need - steerOffset, -TURN_RATE * dtp, TURN_RATE * dtp);
    steerOffset = clamp(steerOffset + delta, -MAX_OFFSET, MAX_OFFSET);
    var na = cur + steerOffset;
    self.mx = Math.cos(na) * mag;
    self.my = Math.sin(na) * mag;
  }

  /* ---------------- DOM ---------------- */

  function injectCSS() {
    if (document.getElementById('navmarks-css')) return;
    var css = document.createElement('style');
    css.id = 'navmarks-css';
    css.textContent =
      '#starmap-systems.arming{cursor:crosshair}' +
      '#starmap-systems.arming .sys-node{outline:2px dashed #39d5e8;outline-offset:4px}' +
      '#btn-navmark.armed{border-color:#39d5e8;box-shadow:0 0 12px rgba(57,213,232,.6)}' +
      '#btn-navhold.holding{border-color:#39d5e8;color:#39d5e8;' +
      'box-shadow:0 0 10px rgba(57,213,232,.55)}';
    document.head.appendChild(css);
  }

  function paintArmButton() {
    var b = document.getElementById('btn-navmark');
    if (!b) return;
    b.classList.toggle('armed', armed);
    b.textContent = mark ? '⌖ CLEAR WAYPOINT'
      : (armed ? '◎ TAP THE MAP… (cancel)' : '◎ SET WAYPOINT');
  }

  function paintHoldButton() {
    if (!holdBtn) return;
    holdBtn.classList.toggle('holding', hold);
    holdBtn.textContent = hold ? '🧭 HOLD ● [H]' : '🧭 HOLD [H]';
    holdBtn.style.opacity = mark ? '1' : '0.55';
  }

  function ensureOverlay() {
    if (cv) return;
    injectCSS();
    cv = document.createElement('canvas');
    cv.id = 'navmark-overlay';
    cv.style.cssText = 'position:fixed;inset:0;z-index:16;pointer-events:none;';
    document.body.appendChild(cv);
    g = cv.getContext('2d');
    sizeCanvas();
  }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = Math.floor(vw * dpr), H = Math.floor(vh * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function uiScale() {
    var vw = window.innerWidth;
    return vw <= 480 ? 0.78 : (vw <= 700 ? 0.88 : 1);
  }

  function ensureHoldButton() {
    if (holdBtn || !document.getElementById('hud-buttons')) return;
    holdBtn = document.createElement('button');
    holdBtn.id = 'btn-navhold';
    holdBtn.className = 'btn small ui-block';
    holdBtn.addEventListener('click', function () {
      if (window.SF && SF.Audio) SF.Audio.unlock();
      toggleHold();
    });
    document.getElementById('hud-buttons').appendChild(holdBtn);
    paintHoldButton();
  }

  function ensureKeybind() {
    if (window._navmarksKeyBound) return;
    window._navmarksKeyBound = true;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'KeyH' && window.SF && SF.Game && SF.Game.state === 'PLAYING') {
        toggleHold();
      }
    });
  }

  /* ---------------- star-map drop ---------------- */

  function onMapTap(e) {
    if (!armed) return;
    var t = e.target;
    if (t && t.closest && t.closest('.sys-node')) return; // node clicks still travel
    var wrap = document.getElementById('starmap-systems');
    if (!wrap || !window.SF || !SF.Game) return;
    var r = wrap.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var ws = (SF.CONFIG && SF.CONFIG.worldSize) || 4200;
    var x = clamp(((e.clientX - r.left) / r.width) * ws, 50, ws - 50);
    var y = clamp(((e.clientY - r.top) / r.height) * ws, 50, ws - 50);
    setMark(SF.Game.systemId, x, y);
    armed = false;
    wrap.classList.remove('arming');
    paintArmButton();
    try { if (SF.Audio && SF.Audio.ui) SF.Audio.ui(); } catch (err) {}
    toast('⌖ Waypoint set — ' + fmtDist(distToMark()) + ' (' + sysName(SF.Game.systemId) + ')');
  }

  function injectStarmapUI() {
    injectCSS();
    var panel = document.querySelector('#overlay-starmap .panel');
    var closeBtn = document.getElementById('btn-starmap-close');
    if (panel && closeBtn && !document.getElementById('btn-navmark')) {
      var b = document.createElement('button');
      b.id = 'btn-navmark';
      b.className = 'btn big ui-block';
      b.style.marginTop = '8px';
      b.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.unlock();
        if (mark) {
          clearMark();
          toast('⌖ Waypoint cleared');
          return;
        }
        armed = !armed;
        var wrap = document.getElementById('starmap-systems');
        if (wrap) wrap.classList.toggle('arming', armed);
        paintArmButton();
        toast(armed ? 'Tap anywhere on the map to drop a waypoint'
                    : 'Waypoint mode off');
      });
      panel.insertBefore(b, closeBtn);
      paintArmButton();
    }
    var wrap2 = document.getElementById('starmap-systems');
    if (wrap2 && !wrap2._navmarksBound) {
      wrap2._navmarksBound = true;
      wrap2.addEventListener('click', onMapTap);
    }
  }

  /* ---------------- per-frame paint + arrival ---------------- */

  function tick() {
    ensureOverlay();
    ensureHoldButton();
    if (!window.SF || !SF.Game || !SF.Player) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (SF.Game.state !== 'PLAYING') {
      g.clearRect(0, 0, vw, vh);
      return;
    }
    sizeCanvas();

    if (mark && markInSystem()) {
      var d = distToMark();
      if (d <= ARRIVE_DIST) { arrive(); g.clearRect(0, 0, vw, vh); return; }
    }

    /* camera follow lerp (same recipe as main.js / SF.Tracker) */
    var sys = SF.Game.systemId;
    if (sys !== lastSys) { rcx = null; lastSys = sys; }
    var now = nowMs();
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016;
    lastT = now;
    if (rcx === null) { rcx = SF.Player.x - vw / 2; rcy = SF.Player.y - vh / 2; }
    var k = Math.min(1, 6 * dt);
    rcx += (SF.Player.x - vw / 2 - rcx) * k;
    rcy += (SF.Player.y - vh / 2 - rcy) * k;

    g.clearRect(0, 0, vw, vh);
    if (!mark || !markInSystem()) return;

    var sx = mark.x - rcx, sy = mark.y - rcy;
    var us = uiScale();
    var t = now / 1000;
    var dTxt = fmtDist(distToMark());
    var m = 70 * us;

    if (sx > m && sx < vw - m && sy > m && sy < vh - m) {
      /* onscreen: pulsing diamond + distance readout */
      var pulse = 0.5 + 0.5 * Math.sin(t * 4);
      var r = (16 + pulse * 6) * us;
      g.save();
      g.translate(sx, sy);
      g.rotate(Math.PI / 4 + t * 0.9);
      g.strokeStyle = COLOR;
      g.globalAlpha = 0.65 + 0.35 * pulse;
      g.lineWidth = 2.5 * us;
      g.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
      g.restore();
      g.globalAlpha = 1;
      g.fillStyle = COLOR;
      g.font = 'bold ' + Math.round(13 * us) + 'px monospace';
      g.textAlign = 'center';
      g.fillText('⌖ NAV MARK', sx, sy - (r + 14 * us));
      g.fillStyle = '#dfe9ff';
      g.font = Math.round(12 * us) + 'px monospace';
      g.fillText(dTxt, sx, sy + (r + 20 * us));
      /* heading-hold bearing line: thin dashed ship→waypoint */
      if (hold) {
        var px = SF.Player.x - rcx, py = SF.Player.y - rcy;
        g.save();
        g.strokeStyle = COLOR;
        g.globalAlpha = 0.35;
        g.lineWidth = 1.5 * us;
        g.setLineDash([6 * us, 6 * us]);
        g.beginPath(); g.moveTo(px, py); g.lineTo(sx, sy); g.stroke();
        g.restore();
        g.globalAlpha = 1;
      }
    } else {
      /* offscreen: edge arrow + distance */
      var cx = vw / 2, cy = vh / 2;
      var ang = Math.atan2(sy - cy, sx - cx);
      var px2 = intersectRect(cx, cy, ang, vw, vh, m);
      g.save();
      g.translate(px2.x, px2.y);
      g.rotate(ang);
      g.translate(Math.sin(t * 5) * 4 * us, 0);
      var s = 16 * us;
      g.fillStyle = COLOR;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s, 0); g.lineTo(-s * 0.6, -s * 0.7); g.lineTo(-s * 0.6, s * 0.7);
      g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = '#dfe9ff';
      g.font = Math.round(12 * us) + 'px monospace';
      g.textAlign = 'center';
      g.fillText(dTxt,
        px2.x - Math.cos(ang) * 34 * us, px2.y - Math.sin(ang) * 34 * us + 4);
    }
  }

  /* intersect a ray from (cx,cy) at angle ang with the inset rect */
  function intersectRect(cx, cy, ang, vw, vh, m) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var tx = dx > 0 ? (vw - m - cx) / dx : (dx < 0 ? (m - cx) / dx : Infinity);
    var ty = dy > 0 ? (vh - m - cy) / dy : (dy < 0 ? (m - cy) / dy : Infinity);
    var t = Math.min(tx, ty);
    if (!isFinite(t) || t < 0) t = 0;
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /* ---------------- hooks (additive, idempotent) ---------------- */

  function wrap(obj, name, fn) {
    var orig = obj[name];
    if (typeof orig !== 'function' || orig._navmarksWrapped) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { fn.apply(this, arguments); } catch (e) {}
      return r;
    };
    w._navmarksWrapped = true;
    /* combat-death-recap (2026-10-21): propagate other phases' `_`
     * idempotency flags onto the new wrapper, so their re-hook guards keep
     * working when this wrap lands on top of them. Without this, a phase
     * that re-hooks takeDamage (e.g. the death-recap recorder's 3s
     * re-hook) sees a flagless outer wrapper and installs a duplicate
     * recorder. Same convention as SF.CombatFeed's wrap() and main.js's
     * propagateFlags(). Behavior of navmarks itself is unchanged. */
    for (var k in orig) {
      if (k.charAt(0) === '_' && !(k in w) && typeof orig[k] !== 'function') {
        try { w[k] = orig[k]; } catch (pe) {}
      }
    }
    obj[name] = w;
  }

  function drawMinimapMark() {
    if (!markInSystem()) return;
    var mm = document.getElementById('minimap');
    if (!mm) return;
    var ctx = mm.getContext('2d');
    /* open-space-1: NavMark diamond follows the player-centered window. */
    var tr = (window.SF && SF.Space && SF.Space.minimapTransform) ?
      SF.Space.minimapTransform(mm) : null;
    var t = nowMs() / 1000;
    var pulse = 0.5 + 0.5 * Math.sin(t * 4);
    var r = 4 + pulse * 2;
    ctx.save();
    ctx.translate(tr ? tr.x(mark.x) : mark.x * (mm.width / ((window.SF && SF.CONFIG && SF.CONFIG.worldSize) || 4200)),
                  tr ? tr.y(mark.y) : mark.y * (mm.height / ((window.SF && SF.CONFIG && SF.CONFIG.worldSize) || 4200)));
    ctx.rotate(Math.PI / 4 + t * 0.9);
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
    ctx.restore();
  }

  function hookAll() {
    if (!window.SF || !SF.HUD || !SF.Player || !SF.Station ||
        !SF.Starmap || !SF.Input) return false;
    /* per-frame paint + arrival check rides the HUD update */
    wrap(SF.HUD, 'update', function () { tick(); });
    /* minimap diamond */
    wrap(SF.HUD, 'drawMinimap', function () { drawMinimapMark(); });
    /* steering assist rides the input poll (after the UX deadzone wrap) */
    (function () {
      var orig = SF.Input.poll;
      if (typeof orig !== 'function' || orig._navmarksWrapped) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { holdAssist(this); } catch (e) {}
        lastPollT = nowMs();
        return r;
      };
      w._navmarksWrapped = true;
      SF.Input.poll = w;
    })();
    /* combat damage disengages heading-hold */
    wrap(SF.Player, 'takeDamage', function (dmg) {
      if (dmg > 0 && hold) disengage('taking fire');
    });
    /* docking clears the waypoint; new game resets everything */
    wrap(SF.Station, 'dock', function () { clearMark(); });
    /* star-map drop UI */
    wrap(SF.Starmap, 'open', function () { injectStarmapUI(); });
    wrap(SF.Starmap, 'close', function () {
      armed = false;
      var wrapEl = document.getElementById('starmap-systems');
      if (wrapEl) wrapEl.classList.remove('arming');
      paintArmButton();
    });
    ensureHoldButton();
    ensureKeybind();
    if (SF.Game) {
      wrap(SF.Game, 'newGame', function () { clearMark(); });
      /* jumps do NOT clear the waypoint — it persists; announce on arrival */
      wrap(SF.Game, 'travelTo', function () {
        if (mark && window.SF && SF.Game && mark.systemId === SF.Game.systemId) {
          toast('⌖ Waypoint in this system — ' + fmtDist(distToMark()) +
                ' (' + sysName(mark.systemId) + ')');
        }
      });
      hooked = true;
    }
    return hooked;
  }

  if (!hookAll() && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (hookAll()) clearInterval(iv); }, 500);
  }

  return {
    state: function () {
      return {
        mark: mark ? { systemId: mark.systemId, x: Math.round(mark.x), y: Math.round(mark.y) } : null,
        hold: hold,
        armed: armed
      };
    },
    set: setMark,       // programmatic set (tests, future phases)
    clear: clearMark,
    toggleHold: toggleHold,
    ARRIVE_DIST: ARRIVE_DIST,
    _tick: tick         // test hook
  };
})();

/* ================= photo-mode phase (2026-10-20) =================
 * SF.PhotoMode: cinematic photo mode for screenshots / clips.
 *
 * - Toggle: HUD camera button (#btn-photo, runtime-created) or keybind P.
 *   Entering requires SF.Game.state === 'PLAYING'.
 * - Hides ALL HUD chrome (bars, stats, minimap, buttons, quest tracker line
 *   + overlay canvas, boss bar, tutorial overlays, touch sticks, FIRE button,
 *   dock/board/investigate/rescue prompts, toast, damage flash, nav-mark
 *   overlay) while the world canvas (#game) keeps rendering. Hiding is done
 *   with inline display:none + an inline-display snapshot per element, so
 *   exit restores every element EXACTLY as it was (classList states are never
 *   touched by this module, except via the stock SF.HUD.showHud toggle).
 * - Slow cinematic Ken Burns drift: the #game canvas gets a CSS transform
 *   (slow push-in 1.06 -> 1.16 over ~100s + sinusoidal pan, pan amplitude
 *   clamped so the scaled canvas never reveals an edge).
 * - Canvas-drawn HUD chrome from other phases is hidden too: the wingman
 *   formation chips (ship.js) and mining timing bar (main.js) are skipped
 *   via runtime wraps while photo is active (this file's established wrap
 *   convention); the closure-private reactor widget gets a post-render mask
 *   rect from photo mode's own rAF chain (queued after the game's render).
 * - Optional letterbox bars (default on, L toggles while in photo mode).
 * - Shutter capture (photomode-voice-wiring phase, 2026-10-20): #photo-shot
 *   button or KeyC while active captures the #game canvas to a PNG download
 *   (with a white flash frame). voice-pack-5 lines: photo_01 on enter,
 *   photo_02 on shutter, photo_03 when the shot is saved, photo_04 on exit —
 *   all guarded (if (SF.Audio && SF.Audio.voice)). Save-neutral.
 * - Combat continues (NOT a pause): enemies, projectiles, damage all run.
 *   Auto-exit (with toast) when hull drops below 25%. Also exits silently on
 *   any state change away from PLAYING (dock / starmap / death / dialogue).
 * - Save-neutral: pure runtime, no SAVE_VERSION bump, no save-blob changes.
 *
 * Integration is strictly additive + idempotent: runtime-created DOM/CSS only,
 * a dedicated rAF loop (no-ops when inactive), one window keydown listener.
 * js/main.js, index.html, css/ and every other phase file are untouched.
 */
window.SF = window.SF || {};

SF.PhotoMode = (function () {
  'use strict';

  var active = false;
  var savedDisplays = {}; // chrome id -> inline style.display before hiding
  var letterboxOn = true;
  var driftT = 0, lastFrameT = 0;
  var photoBtn = null, hintBar = null, hintExit = null;
  var lbTop = null, lbBot = null, hintFadeTimer = null;

  /* every DOM surface that counts as HUD chrome (#game world canvas stays) */
  var CHROME = [
    'hud',                // bars, stats, minimap, hud-buttons (+runtime buttons)
    'news-ticker',        // inside #hud; explicit in case of future moves
    'tracker-overlay',    // SF.Tracker objective-line canvas
    'navmark-overlay',    // SF.NavMarks canvas
    'boss-bar',           // SF.BossBar
    'tutorial-overlay', 'tutorial-chip',
    'toast', 'damage-flash',
    'joystick', 'aimstick', 'btn-fire',   // touch controls
    'dock-prompt', 'board-prompt', 'investigate-prompt', 'rescue-prompt',
    'combat-feed'                   // combat-text-feed phase: floating event stack
  ];

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    try { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
  }

  function sfxUI() {
    try { if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui(); } catch (e) {}
  }

  /* voice-pack-5 photo lines (photomode-voice-wiring phase, 2026-10-20):
   * guarded SF.Audio.voice calls — no-op when audio isn't ready. ids are
   * from phases/voice-pack-5/VOICE-MANIFEST-5.md: photo_01 (enter),
   * photo_02 (shutter), photo_03 (saved), photo_04 (exit). */
  function voiceLine(id) {
    try { if (window.SF && SF.Audio && SF.Audio.voice) SF.Audio.voice(id); } catch (e) {}
  }

  /* ---------------- canvas-drawn HUD chrome (other phases) ----------------
   * Two screen-space widgets are painted directly on the #game canvas by
   * other phases: the wingman formation chips (ship.js, exposed as
   * SF.WingmanFormations.drawFormationWidget) and the mining timing bar
   * (main.js, SF.MiningBar.draw). Both are wrapped here — skipped while
   * photo mode is active — following this file's established wrap
   * convention (cf. SF.NavMarks wrapping SF.HUD.update from this file).
   * The reactor profile widget (ship.js) is closure-private, so it gets a
   * post-render mask rect instead (see maskReactorWidget). No other phase
   * file is edited. */

  function wrapSkippable(getter, name) {
    var obj;
    try { obj = getter(); } catch (e) { return false; }
    if (!obj) return false;
    var orig = obj[name];
    if (typeof orig !== 'function' || orig._photomodeWrapped) return true;
    var w = function () {
      if (active) return; // photo mode: hide this HUD-chrome drawing
      return orig.apply(this, arguments);
    };
    w._photomodeWrapped = true;
    obj[name] = w;
    return true;
  }

  function installCanvasWraps() {
    var okW = wrapSkippable(function () {
      return (window.SF && SF.WingmanFormations) ? SF.WingmanFormations : null;
    }, 'drawFormationWidget');
    var okM = wrapSkippable(function () {
      return (window.SF && SF.MiningBar) ? SF.MiningBar : null;
    }, 'draw');
    return okW && okM;
  }

  /* Reactor widget mask: closure-private in ship.js, so after the game's
   * render we paint its zone back to the void. Runs in the photo rAF chain,
   * which is queued AFTER the game's own rAF callback, so the mask lands on
   * top of the finished frame. Zone (CSS px): chips y 64-90, heat bar
   * 95-102, status line ~102-120. Only painted when a reactor widget
   * exists (SF.Player.reactorState()). */
  function maskReactorWidget() {
    var has;
    try {
      has = !!(window.SF && SF.Player && SF.Player.reactorState &&
        SF.Player.reactorState());
    } catch (e) { has = false; }
    if (!has) return;
    var game = $('game');
    if (!game || !game.getContext) return;
    var vw = window.innerWidth;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var c = game.getContext('2d');
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#04060f';
    c.fillRect(0, 56, vw, 72);
    c.restore();
  }

  /* ---------------- DOM / CSS ---------------- */

  function injectCSS() {
    if ($('photomode-css')) return;
    var css = document.createElement('style');
    css.id = 'photomode-css';
    css.textContent =
      '#photo-lb-top,#photo-lb-bot{position:fixed;left:0;right:0;height:8vh;' +
      'background:#000;z-index:40;pointer-events:none}' +
      '#photo-lb-top{top:0}#photo-lb-bot{bottom:0}' +
      '#photo-hint{position:fixed;left:50%;transform:translateX(-50%);bottom:10vh;' +
      'z-index:9500;display:flex;align-items:center;gap:10px;padding:8px 14px;' +
      'border-radius:20px;background:rgba(6,12,26,.82);border:1px solid #39d5e8;' +
      'color:#dfe9ff;font:13px monospace;letter-spacing:1px;white-space:nowrap;' +
      'transition:opacity .8s}' +
      '#photo-hint.photo-fade{opacity:.16}' +
      '#photo-shot{padding:6px 14px;border-radius:12px;border:1px solid #39d5e8;' +
      'background:rgba(6,40,52,.85);color:#fff;font:13px monospace;cursor:pointer;' +
      'letter-spacing:1px}' +
      '#photo-exit{padding:6px 14px;border-radius:12px;border:1px solid #ff5e3a;' +
      'background:rgba(60,10,6,.85);color:#fff;font:13px monospace;cursor:pointer;' +
      'letter-spacing:1px}';
    document.head.appendChild(css);
  }

  function ensurePhotoDom() {
    injectCSS();
    if (!lbTop) {
      lbTop = document.createElement('div');
      lbTop.id = 'photo-lb-top'; lbTop.style.display = 'none';
      lbBot = document.createElement('div');
      lbBot.id = 'photo-lb-bot'; lbBot.style.display = 'none';
      document.body.appendChild(lbTop);
      document.body.appendChild(lbBot);
    }
    if (!hintBar) {
      hintBar = document.createElement('div');
      hintBar.id = 'photo-hint'; hintBar.style.display = 'none';
      var label = document.createElement('span');
      label.textContent = '\uD83D\uDCF7 PHOTO MODE \u00B7 P exit \u00B7 C shot \u00B7 L letterbox';
      var shotBtn = document.createElement('button');
      shotBtn.id = 'photo-shot';
      shotBtn.textContent = '\uD83D\uDCF7 SHOT';
      shotBtn.addEventListener('click', function () {
        takeShot();
      });
      hintExit = document.createElement('button');
      hintExit.id = 'photo-exit';
      hintExit.textContent = 'EXIT';
      hintExit.addEventListener('click', function () {
        if (window.SF && SF.Audio) SF.Audio.unlock();
        exitPhoto();
        toast('Photo mode off');
      });
      hintBar.appendChild(label);
      hintBar.appendChild(shotBtn);
      hintBar.appendChild(hintExit);
      hintBar.addEventListener('pointerdown', function () {
        hintBar.classList.remove('photo-fade');
        scheduleHintFade();
      });
      document.body.appendChild(hintBar);
    }
  }

  function ensurePhotoButton() {
    if (photoBtn || !$('hud-buttons')) return;
    photoBtn = document.createElement('button');
    photoBtn.id = 'btn-photo';
    photoBtn.className = 'btn small ui-block';
    photoBtn.textContent = '\uD83D\uDCF7 PHOTO [P]';
    photoBtn.addEventListener('click', function () {
      if (window.SF && SF.Audio) SF.Audio.unlock();
      togglePhoto();
    });
    /* twelve-hour-wave5 sellability polish: photo mode is the MENU drawer's
     * FIRST button, not one more entry buried under runtime appends — one
     * discoverable entry point, no new system, no wiring change. */
    var hbb = $('hud-buttons');
    if (hbb.firstChild) hbb.insertBefore(photoBtn, hbb.firstChild);
    else hbb.appendChild(photoBtn);
  }

  function scheduleHintFade() {
    if (hintFadeTimer) clearTimeout(hintFadeTimer);
    hintFadeTimer = setTimeout(function () {
      if (active && hintBar) hintBar.classList.add('photo-fade');
    }, 4000);
  }

  /* ---------------- chrome hide / restore ---------------- */

  function hideChrome() {
    if (window.SF && SF.HUD && SF.HUD.showHud) SF.HUD.showHud(false);
    for (var i = 0; i < CHROME.length; i++) {
      var e = $(CHROME[i]);
      if (!e) continue;
      if (!(CHROME[i] in savedDisplays)) savedDisplays[CHROME[i]] = e.style.display;
      e.style.display = 'none';
    }
  }

  /* Re-assert hiding every frame: other modules repaint via classList (their
   * classes can't beat our inline display:none, but late-created DOM needs
   * catching). Cheap: ~17 getElementById per frame, only while active. */
  function reassertChrome() {
    for (var i = 0; i < CHROME.length; i++) {
      var e = $(CHROME[i]);
      if (e && e.style.display !== 'none') {
        if (!(CHROME[i] in savedDisplays)) savedDisplays[CHROME[i]] = e.style.display;
        e.style.display = 'none';
      }
    }
  }

  function restoreChromeDisplays() {
    for (var id in savedDisplays) {
      if (!Object.prototype.hasOwnProperty.call(savedDisplays, id)) continue;
      var e = $(id);
      if (e) e.style.display = savedDisplays[id];
    }
    savedDisplays = {};
  }

  /* ---------------- cinematic drift ----------------
   * CSS transform on the world canvas (screen-space translate AFTER scale:
   * `translate() scale()` applies the scale first, then translates in
   * screen px). Pan amplitude is clamped so the scaled canvas never exposes
   * an edge: |t| <= (s-1)*v/(2s) - 2. */

  function applyDrift() {
    var game = $('game');
    if (!game) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var zoom = Math.min(1.16, 1.06 + driftT * (0.10 / 100)); // ~100s push-in
    var maxX = Math.max(0, ((zoom - 1) * vw) / (2 * zoom) - 2);
    var maxY = Math.max(0, ((zoom - 1) * vh) / (2 * zoom) - 2);
    var tx = Math.sin(driftT * 2 * Math.PI / 46) * Math.min(36, maxX);
    var ty = Math.sin(driftT * 2 * Math.PI / 61 + 1.3) * Math.min(24, maxY);
    game.style.transform =
      'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + zoom.toFixed(4) + ')';
  }

  function clearDrift() {
    var game = $('game');
    if (game) game.style.transform = '';
  }

  function showLetterbox(v) {
    if (lbTop) lbTop.style.display = v ? '' : 'none';
    if (lbBot) lbBot.style.display = v ? '' : 'none';
  }

  /* ---------------- enter / exit / toggle ---------------- */

  function enterPhoto() {
    if (active) return true;
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') {
      toast('Photo mode needs open space \u2014 undock first');
      try { if (SF.Audio && SF.Audio.deny) SF.Audio.deny(); } catch (e) {}
      return false;
    }
    active = true;
    driftT = 0; lastFrameT = 0;
    ensurePhotoDom();
    ensurePhotoButton();
    hideChrome();
    showLetterbox(letterboxOn);
    hintBar.style.display = '';
    hintBar.classList.remove('photo-fade');
    scheduleHintFade();
    sfxUI();
    voiceLine('photo_01'); // "Photo mode. Frame your shot"
    startChain();
    return true;
  }

  /* silent: no HUD re-show (used when a state change already owns HUD
   * visibility — the wrapped setState / rAF state guard calls this). */

  /* ---------------- shutter + save (photomode-voice-wiring phase) --------
   * Photo mode had no capture flow, so this phase adds the minimal one the
   * voice-pack-5 photo lines were written for: photo_02 at shutter time,
   * photo_03 when the shot is confirmed saved. Canvas PNG via toDataURL:
   * anchor download in browsers; in the APK shell the PNG goes through
   * the StarfallNative MediaStore bridge and photo_03 waits for the
   * native callback (device-truth-1 — see takeShot). Save-neutral: no
   * localStorage / save-schema changes. */
  function shutterFlash() {
    try {
      var f = document.createElement('div');
      f.id = 'photo-flash';
      f.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:.85;' +
        'z-index:9990;pointer-events:none;transition:opacity .45s';
      document.body.appendChild(f);
      setTimeout(function () { f.style.opacity = '0'; }, 30);
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 600);
    } catch (e) {}
  }

  /* ---------------- native photo save (device-truth-1 phase, 2026-10-23)
   * In the APK shell the anchor download below goes NOWHERE: the WebView
   * has no DownloadListener, so the shot silently vanished while photo_03
   * and "Shot saved" played anyway. The shell now exposes a one-method
   * bridge, window.StarfallNative.savePhoto(base64, fileName), which
   * writes the PNG via MediaStore into Pictures/Starfall and calls back
   * window.__sfPhotoResult(ok, err) once the write settles. photo_03 +
   * the success toast fire ONLY from that callback on ok=true; a native
   * failure (or no callback within 15s — better an honest failure than a
   * false success) toasts the failure and never plays photo_03. In a
   * plain browser there is no bridge and the original anchor-download
   * path runs unchanged. */
  var photoSaveSeq = 0, photoSavePending = 0, photoSaveTimer = null;

  function settlePhotoSave(ok, err) {
    if (!photoSavePending) return; // stray/late callback — already settled
    photoSavePending = 0;
    if (photoSaveTimer) { clearTimeout(photoSaveTimer); photoSaveTimer = null; }
    if (ok) {
      voiceLine('photo_03'); // "Cinematic shot saved to your gallery"
      toast('\uD83D\uDCF7 Shot saved');
    } else {
      toast('\uD83D\uDCF7 Shot failed to save' +
        (err ? ' \u2014 ' + String(err).slice(0, 60) : ''));
    }
  }

  window.__sfPhotoResult = function (ok, err) { settlePhotoSave(!!ok, err); };

  function takeShot() {
    if (!active) return false;
    voiceLine('photo_02'); // "Shutter... captured"
    shutterFlash();
    var url = null;
    try {
      var game = $('game');
      if (game && game.toDataURL) url = game.toDataURL('image/png');
    } catch (e) {}
    if (!url) { toast('Shot failed \u2014 canvas unavailable'); return false; }
    var fileName = 'starfall-photo-' + Date.now() + '.png';
    /* device shell: hand the PNG to the native bridge and let the
     * __sfPhotoResult callback deliver the verdict — no celebration
     * until the write is confirmed. A synchronous bridge throw is an
     * honest failure, NOT a reason to fall through to the anchor path
     * (which cannot work in the shell). */
    var bridge = null;
    try {
      if (window.StarfallNative &&
          typeof window.StarfallNative.savePhoto === 'function') {
        bridge = window.StarfallNative;
      }
    } catch (e) {}
    if (bridge) {
      try {
        photoSavePending = ++photoSaveSeq;
        if (photoSaveTimer) clearTimeout(photoSaveTimer);
        photoSaveTimer = setTimeout(function () {
          settlePhotoSave(false, 'no reply from the app shell');
        }, 15000);
        bridge.savePhoto(url.replace(/^data:image\/png;base64,/, ''), fileName);
        return true;
      } catch (e) {
        settlePhotoSave(false, 'app shell refused the shot');
        return false;
      }
    }
    /* plain browser: original download path */
    try {
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      voiceLine('photo_03'); // "Cinematic shot saved to your gallery"
      toast('\uD83D\uDCF7 Shot saved');
      return true;
    } catch (e) {
      toast('Shot captured \u2014 save unavailable on this build');
      return false;
    }
  }

  function exitPhotoSilent() {
    if (!active) return;
    active = false;
    chainSeq++; // invalidate any running rAF chain
    if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null; }
    clearDrift();
    showLetterbox(false);
    if (hintBar) hintBar.style.display = 'none';
    restoreChromeDisplays();
  }

  function exitPhoto() {
    if (!active) return;
    exitPhotoSilent();
    voiceLine('photo_04'); // "Photo mode off. Back to the fight"
    /* restore the HUD exactly when we're still flying; a state change that
     * owns the HUD (dock/starmap/death) leaves its own visibility in place */
    if (window.SF && SF.Game && SF.Game.state === 'PLAYING' &&
        window.SF && SF.HUD && SF.HUD.showHud) {
      SF.HUD.showHud(true);
    }
  }

  function togglePhoto() {
    if (active) { exitPhoto(); toast('Photo mode off'); }
    else enterPhoto();
  }

  /* ---------------- per-frame driver ----------------
   * Dedicated rAF (no-ops when inactive) so the drift, the hull guard and
   * the state-change exit all work even when main.js isn't calling
   * SF.HUD.update (DOCKED/STARMAP/GAMEOVER). */

  function tick(now) {
    if (SF.Game.state !== 'PLAYING') { exitPhotoSilent(); return; }
    reassertChrome();
    var dt = lastFrameT ? Math.min(0.1, (now - lastFrameT) / 1000) : 0.016;
    lastFrameT = now;
    driftT += dt;
    applyDrift();
    maskReactorWidget();
    /* combat continues in photo mode — but bail out to protect the player */
    try {
      var mh = (SF.Player && typeof SF.Player.maxHull === 'function')
        ? SF.Player.maxHull() : 0;
      if (mh > 0 && SF.Player.hull / mh < 0.25) {
        exitPhoto();
        toast('\u26A0 Photo mode off \u2014 hull critical (' +
          Math.round(100 * SF.Player.hull / mh) + '%)');
      }
    } catch (e) {}
  }

  /* Photo rAF chain: registered on enter (the game already has its own
   * callback queued, so ours lands after it) and re-chained at the END of
   * our callback — every frame we run after the game's render, which is
   * what the post-render reactor mask needs. The chainSeq token keeps a
   * stale chain from a previous session from surviving a re-enter. The
   * chain stops when photo exits; nothing runs while inactive. */
  var chainSeq = 0;

  function startChain() {
    var my = ++chainSeq;
    function pf(now) {
      if (my !== chainSeq || !active) return;
      tick(now || ((typeof performance !== 'undefined') ? performance.now() : Date.now()));
      requestAnimationFrame(pf);
    }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(pf);
  }

  function ensureKeybind() {
    if (window._photomodeKeyBound) return;
    window._photomodeKeyBound = true;
    window.addEventListener('keydown', function (e) {
      if (!window.SF || !SF.Game) return;
      if (e.code === 'KeyP' && SF.Game.state === 'PLAYING') togglePhoto();
      else if (e.code === 'KeyC' && active) takeShot(); // KeyS is thrust-down; KeyC = capture
      else if (e.code === 'KeyL' && active) {
        letterboxOn = !letterboxOn;
        showLetterbox(letterboxOn);
        sfxUI();
      }
    });
  }

  /* install: DOM is parsed (scripts sit at end of body); the keybind and
   * button are safe before SF.Game exists. SF.MiningBar lives in main.js
   * (loads after this file); retry the canvas wraps until they land. */
  if (!window._photomodeInstalled) {
    window._photomodeInstalled = true;
    ensurePhotoDom();
    ensurePhotoButton();
    ensureKeybind();
    if (!installCanvasWraps() && typeof setInterval !== 'undefined') {
      var iv = setInterval(function () { if (installCanvasWraps()) clearInterval(iv); }, 500);
    }
  }

  return {
    enter: enterPhoto,
    exit: exitPhoto,
    toggle: togglePhoto,
    active: function () { return active; },
    letterbox: function () { return letterboxOn; },
    CHROME_IDS: CHROME.slice(),
    state: function () {
      return { active: active, letterbox: letterboxOn, driftT: driftT };
    },
    _tick: tick // test hook
  };
})();
/* ================= hud-damage-direction-retry phase (2026-10-19) =================
 * SF.DamageFX: directional damage feedback (canvas overlay, hud.js ONLY).
 *
 * Retry of the failed hud-damage-direction phase (previous builder vanished
 * with zero staging output — clean rebuild).
 *
 * Features:
 *  - Damage direction arc: red arc segment at the screen edge pointing toward
 *    the damage source, fading over 1.2s, stacking intensity with rapid hits.
 *  - Low-hull (<30%) pulsing red vignette.
 *  - Shield-break full-screen flash (white-blue, 300ms).
 *
 * Integration is strictly additive + idempotent:
 *  - hit events are read by wrapping SF.Player.takeDamage (js/ship.js is out
 *    of scope); the source bearing is resolved at hit time from the nearest
 *    active enemy projectile (then nearest enemy for contact hits).
 *  - paint() is driven from SF.HUD.update (this file).
 *  - dedicated overlay canvas (z-index 8000, pointer-transparent).
 *  - quality-aware: SF.FX.getEffective() === 'low' draws simplified arcs
 *    (thinner, no inner glow) and a non-pulsing vignette.
 *  - SAVE-NEUTRAL: no save fields touched, no SAVE_VERSION bump.
 */
window.SF = window.SF || {};

SF.DamageFX = (function () {
  'use strict';

  var cv = null, g = null, dpr = 1, built = false, hooked = false;
  var hits = [];            /* {ang, t0, intensity} */
  var shieldFlashT0 = -1e9;

  var ARC_FADE = 1.2;       /* s */
  var FLASH_FADE = 0.3;     /* s */
  var LOW_HULL_FRAC = 0.30;
  var SRC_RANGE2 = 400 * 400;

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  function lowQ() {
    try {
      return !!(window.SF && SF.FX && SF.FX.getEffective &&
        SF.FX.getEffective() === 'low');
    } catch (e) { return false; }
  }

  function ensureDom() {
    if (built) return;
    built = true;
    cv = document.createElement('canvas');
    cv.id = 'dmgfx-overlay';
    cv.style.cssText = 'position:fixed;inset:0;z-index:8000;pointer-events:none;';
    document.body.appendChild(cv);
    g = cv.getContext('2d');
    sizeCanvas();
    hookTakeDamage();
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookTakeDamage);
    }
    /* re-hook if another phase ever re-wraps takeDamage after us */
    if (typeof setInterval !== 'undefined') setInterval(hookTakeDamage, 3000);
  }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = Math.floor(vw * dpr), H = Math.floor(vh * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* Bearing (screen-space, y-down) of the most likely damage source at hit
   * time: nearest active enemy projectile first (it is still in the pool
   * with its x/y at the collision point), then nearest living enemy for
   * contact hits. null = no plausible source (arc skipped). */
  function sourceAngle() {
    var p = SF.Player;
    var i, dx, dy, d2, best = null, bd = SRC_RANGE2;
    try {
      var pool = SF.Projectiles.pool;
      for (i = 0; i < pool.length; i++) {
        var pr = pool[i];
        if (!pr || pr.friendly) continue;
        dx = pr.x - p.x; dy = pr.y - p.y; d2 = dx * dx + dy * dy;
        /* main.js sets pr.active = false just before p.takeDamage(), so
         * the projectile that just hit is already inactive — accept recently
         * deactivated enemy projectiles within 80 units as the hit source. */
        if (!pr.active && d2 > 80 * 80) continue;
        if (d2 < bd) { bd = d2; best = pr; }
      }
    } catch (e) {}
    if (best) return Math.atan2(best.y - p.y, best.x - p.x);
    try {
      var l = SF.Enemies.list;
      if (typeof l === 'function') l = l();
      bd = SRC_RANGE2; best = null;
      for (i = 0; i < l.length; i++) {
        var en = l[i];
        if (!en || en.dead) continue;
        dx = en.x - p.x; dy = en.y - p.y; d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = en; }
      }
      if (best) return Math.atan2(best.y - p.y, best.x - p.x);
    } catch (e2) {}
    return null;
  }

  function registerHit(ang, dmg) {
    if (ang === null || typeof ang !== 'number' || isNaN(ang)) return;
    var t = now();
    var step = Math.min(3, Math.max(0.5, dmg / 40));
    var i;
    for (i = 0; i < hits.length; i++) {
      var h = hits[i];
      /* angular distance on the circle */
      var d = Math.abs(((ang - h.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < 0.4 && t - h.t0 < ARC_FADE) {
        h.intensity = Math.min(3, h.intensity + step); /* stack rapid hits */
        h.t0 = t;                                      /* refresh the fade */
        return;
      }
    }
    hits.push({ ang: ang, t0: t, intensity: step });
    if (hits.length > 12) hits.shift();
  }

  function shieldBreakFX() { shieldFlashT0 = now(); }

  function hookTakeDamage() {
    if (hooked) return;
    if (!window.SF || !SF.Player || typeof SF.Player.takeDamage !== 'function') return;
    var orig = SF.Player.takeDamage;
    if (orig._dmgFxWrapped) { hooked = true; return; }
    hooked = true;
    var w = function (dmg) {
      var P = SF.Player, ang = null;
      var shieldBefore = 0, hullBefore = 0, wasAlive = false;
      try {
        shieldBefore = P.shield; hullBefore = P.hull; wasAlive = !!P.alive;
        ang = sourceAngle();
      } catch (e) {}
      var r = orig.call(this, dmg);
      try {
        if (wasAlive && shieldBefore > 0 && P.shield <= 0) shieldBreakFX();
        if (wasAlive && P.hull < hullBefore) registerHit(ang, dmg);
      } catch (e2) {}
      return r;
    };
    w._dmgFxWrapped = true;
    SF.Player.takeDamage = w;
  }

  function paint() {
    ensureDom();
    sizeCanvas();
    var vw = window.innerWidth, vh = window.innerHeight;
    g.clearRect(0, 0, vw, vh);
    var st = (window.SF && SF.Game) ? SF.Game.state : null;
    if (st !== 'PLAYING' && st !== 'GAMEOVER') return;
    var t = now();
    var low = lowQ();
    var cx = vw / 2, cy = vh / 2;
    var R = Math.max(60, Math.min(vw, vh) / 2 - 40);

    /* ---- damage direction arcs ---- */
    var i, h, age, frac;
    var live = [];
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      age = t - h.t0;
      if (age >= ARC_FADE) continue;
      live.push(h);
      frac = 1 - age / ARC_FADE;
      var inten = Math.min(1, h.intensity / 2);
      var alpha = (0.30 + 0.55 * inten) * frac;
      var spread = low ? 0.32 : 0.5;
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,56,36,' + alpha.toFixed(3) + ')';
      g.lineWidth = low ? 4 : 7 + 7 * inten;
      g.beginPath();
      g.arc(cx, cy, R, h.ang - spread, h.ang + spread);
      g.stroke();
      if (!low) {
        /* inner glow echo */
        g.strokeStyle = 'rgba(255,120,80,' + (alpha * 0.6).toFixed(3) + ')';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, R - 14, h.ang - spread * 0.8, h.ang + spread * 0.8);
        g.stroke();
      }
      g.restore();
    }
    hits = live;

    /* ---- shield-break flash (white-blue, 300ms) ---- */
    var fa = t - shieldFlashT0;
    if (fa < FLASH_FADE) {
      var ffrac = 1 - fa / FLASH_FADE;
      g.fillStyle = 'rgba(190,225,255,' + (0.55 * ffrac).toFixed(3) + ')';
      g.fillRect(0, 0, vw, vh);
    }

    /* ---- low-hull pulsing red vignette ---- */
    try {
      var p = SF.Player;
      if (p && p.alive && typeof p.hull === 'number' &&
          typeof p.maxHull === 'function') {
        var mh = p.maxHull();
        var hf = mh > 0 ? Math.max(0, p.hull) / mh : 1;
        if (hf < LOW_HULL_FRAC) {
          var depth = (LOW_HULL_FRAC - hf) / LOW_HULL_FRAC; /* 0..1 */
          var pulse = low ? 0.5 : 0.42 + 0.22 * Math.sin(t * 5.2);
          var a = Math.min(0.75, pulse * (0.35 + 0.65 * depth));
          var rad = Math.max(vw, vh) * 0.72;
          var grad = g.createRadialGradient(cx, cy, rad * 0.45, cx, cy, rad);
          grad.addColorStop(0, 'rgba(255,30,20,0)');
          grad.addColorStop(1, 'rgba(255,30,20,' + a.toFixed(3) + ')');
          g.fillStyle = grad;
          g.fillRect(0, 0, vw, vh);
        }
      }
    } catch (e) {}
  }

  /* eagerly hook: hud.js is parsed after ship.js, so SF.Player exists */
  try { hookTakeDamage(); } catch (e) {}
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookTakeDamage);
  }

  return {
    paint: paint,

    /* ---- test hooks ---- */
    _hit: function (ang, intensity) { /* deterministic arc injection */
      registerHit(ang, typeof intensity === 'number' ? intensity : 1);
    },
    _shieldFlash: shieldBreakFX,
    _debug: function () {
      var t = now();
      /* twelve-hour-wave2: lowHull snapshot for smoke tests (same 30%
       * threshold as the vignette in paint()). */
      var lh = null;
      try {
        var pp = SF.Player;
        if (pp && pp.alive && typeof pp.hull === 'number' &&
            typeof pp.maxHull === 'function' && pp.maxHull() > 0)
          lh = (Math.max(0, pp.hull) / pp.maxHull()) < LOW_HULL_FRAC;
      } catch (e) {}
      return {
        lowHull: lh,
        arcs: hits.filter(function (h) { return t - h.t0 < ARC_FADE; })
          .map(function (h) {
            return { ang: +h.ang.toFixed(3), age: +(t - h.t0).toFixed(3),
                     intensity: +h.intensity.toFixed(2) };
          }),
        shieldFlashAge: +(t - shieldFlashT0).toFixed(3),
        lowQ: lowQ(),
        hooked: hooked
      };
    },
    _hook: hookTakeDamage
  };
})();

/* ================= target-lock-hud phase (2026-10-20) =================
 * SF.TargetLock: combat QoL — predictive lead pip + target lock-on.
 *
 * - Predictive lead pip: for PROJECTILE-class weapons (bolt/pellet/slug/
 *   orb/emp/starfall — i.e. dumb projectiles that travel; beam is instant,
 *   missile is homing, mine is stationary so those get no pip), a small
 *   amber diamond is drawn ahead of the locked hostile at
 *   target.pos + target.vel * (dist / projectileSpeed).
 * - Lock-on: the hostile nearest to the crosshair within a front arc
 *   auto-locks. Manual cycle: the runtime 🎯 LOCK button (touch) or the L
 *   key (L is skipped while SF.PhotoMode is active — photo uses L for its
 *   own letterbox toggle). Lock breaks on target death or >2500px range.
 * - Lock reticle: corner-bracket reticle + target name (bosses show their
 *   named titles, elites their elite names) + hull bar + distance readout.
 * - Dedicated overlay canvas (z-index 17, above the quest-tracker 15 and
 *   nav-mark 16 canvases — compatible, never competing with their marks).
 * - Breakpoints follow the mobile-ux-pass recipe (<=480 / <=700 / desktop).
 * - SAVE-NEUTRAL: runtime only, no SAVE_VERSION bump, no save-blob fields.
 *
 * Integration is strictly additive + idempotent (this file's convention):
 * enemies are READ from SF.Enemies.list (never written); SF.HUD.update is
 * wrapped (after SF.NavMarks' own wrap) to drive paint(); SF.Input is read
 * for the crosshair direction (aim stick when active, ship facing otherwise);
 * no js/main.js, js/ship.js, js/enemies.js, index.html or css/ edits.
 */
window.SF = window.SF || {};

SF.TargetLock = (function () {
  'use strict';

  var LOCK_RANGE = 2500;   // lock acquires/breaks at this distance (world units)
  var ARC = 0.65;          // front arc half-angle (rad) around the crosshair
  var LOCK_COLOR = '#ff5e3a';
  var PIP_COLOR = '#ffd23f';
  /* projectile-class weapon kinds: dumb projectiles that need leading.
   * beam = instant, missile = homing, mine = stationary -> no pip. */
  var PROJECTILE_KINDS = { bolt: 1, pellet: 1, slug: 1, orb: 1, emp: 1, starfall: 1 };
  var NAME_MAX = 16;       // button label truncation

  var lock = null;         // locked enemy object | null
  var cv = null, g = null, dpr = 1, built = false;
  var lockBtn = null;
  var rcx = null, rcy = null, lastSys = null, lastT = 0;

  /* ---------------- helpers ---------------- */

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  function toast(msg) {
    try { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function fmtDist(d) {
    return d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm';
  }

  /* mobile-ux-pass breakpoints */
  function uiScale() {
    var vw = window.innerWidth;
    return vw <= 480 ? 0.78 : (vw <= 700 ? 0.88 : 1);
  }

  function enemyList() {
    try {
      var l = SF.Enemies.list;
      return (typeof l === 'function') ? l() : (l || []);
    } catch (e) { return []; }
  }

  function stanceOf(e) {
    if (!e || !e.faction) return null;
    try {
      return (window.SF && SF.Factions && SF.Factions.stance)
        ? SF.Factions.stance(e.faction) : null;
    } catch (x) { return null; }
  }

  /* hostiles are lockable: pirates (factionless), bosses, hostile-stance
   * patrols, and neutral patrols once the player has aggroed them.
   * Friendly patrols and neutral convoy freighters (e.trader) never lock. */
  function isHostile(e) {
    if (!e || e.dead) return false;
    if (e.trader) return false;
    if (e.boss) return true;
    if (!e.faction) return true;
    var st = stanceOf(e);
    if (st === 'friendly') return false;
    if (st === 'hostile') return true;
    return !!e.playerAggro;
  }

  /* crosshair direction: the aim stick when active, else the ship's nose */
  function aimDir() {
    try {
      if (window.SF && SF.Input && SF.Input.aimActive &&
          typeof SF.Input.aimAngle === 'number') return SF.Input.aimAngle;
    } catch (e) {}
    return (window.SF && SF.Player) ? SF.Player.angle : 0;
  }

  /* candidates: hostile, in range, inside the front arc — sorted by angular
   * distance to the crosshair, then by world distance. */
  function candidates() {
    var p = SF.Player;
    if (!p) return [];
    var aim = aimDir(), out = [], i, e, dx, dy, dist, diff;
    var l = enemyList();
    for (i = 0; i < l.length; i++) {
      e = l[i];
      if (!isHostile(e)) continue;
      dx = e.x - p.x; dy = e.y - p.y;
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > LOCK_RANGE) continue;
      diff = Math.abs(angDiff(Math.atan2(dy, dx), aim));
      if (diff > ARC) continue;
      out.push({ e: e, diff: diff, dist: dist });
    }
    out.sort(function (a, b) {
      return (a.diff - b.diff) || (a.dist - b.dist);
    });
    return out;
  }

  function targetName(e) {
    if (e.boss && e.bossDef && e.bossDef.title) return e.bossDef.title;
    if (e.eliteName) return e.eliteName;
    if (e.spec && e.spec.scoreName) return e.spec.scoreName;
    return e.type || 'hostile';
  }

  function lockValid() {
    if (!lock) return false;
    if (lock.dead) return false;
    /* removed from the live list (killed + swept, or system reset) */
    if (enemyList().indexOf(lock) < 0) return false;
    if (!window.SF || !SF.Player) return false;
    var d = Math.hypot(lock.x - SF.Player.x, lock.y - SF.Player.y);
    return d <= LOCK_RANGE;
  }

  function clearLock(quiet) {
    lock = null;
    if (!quiet) paintButton();
  }

  function acquire() {
    var c = candidates();
    if (c.length) {
      lock = c[0].e;
      paintButton();
      return true;
    }
    clearLock();
    return false;
  }

  function cycle() {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return false;
    var c = candidates();
    if (!c.length) {
      if (lock) { clearLock(); toast('🎯 no targets in the forward arc'); }
      else toast('🎯 no hostiles in the forward arc');
      return false;
    }
    if (lockValid()) {
      var idx = -1, i;
      for (i = 0; i < c.length; i++) {
        if (c[i].e === lock) { idx = i; break; }
      }
      lock = c[(idx + 1) % c.length].e; // lock missing -> wraps to first
    } else {
      lock = c[0].e;
    }
    paintButton();
    toast('🎯 ' + targetName(lock));
    return true;
  }

  function lockTick() {
    /* returns false when the lock was just broken */
    if (!lock) return true;
    if (lock.dead || enemyList().indexOf(lock) < 0) {
      var nm = targetName(lock);
      clearLock(true);
      toast('🎯 lock lost — ' + nm + ' destroyed');
      paintButton();
      return false;
    }
    var p = SF.Player;
    var d = Math.hypot(lock.x - p.x, lock.y - p.y);
    if (d > LOCK_RANGE) {
      clearLock(true);
      toast('🎯 lock lost — out of range');
      paintButton();
      return false;
    }
    return true;
  }

  function currentWeapon() {
    try {
      return (window.SF && SF.Player && typeof SF.Player.currentWeapon === 'function')
        ? SF.Player.currentWeapon() : null;
    } catch (e) { return null; }
  }

  /* Combat stats for the lead pip. NOTE: SF.Player.currentWeapon() merges the
   * SF.WEAPONS *store* entry, which carries no kind/projectileSpeed — the
   * real combat numbers live in SF.CONFIG.weapons (see js/data.js). Resolve
   * through the config so the pip uses the true projectile speed. */
  function weaponStats() {
    var w = currentWeapon();
    if (!w || !w.id) return null;
    try {
      var cfg = (window.SF && SF.CONFIG && SF.CONFIG.weapons)
        ? SF.CONFIG.weapons[w.id] : null;
      if (!cfg) return null;
      return { id: w.id, kind: cfg.kind, projectileSpeed: cfg.projectileSpeed };
    } catch (e) { return null; }
  }

  function pipPoint(e, projSpeed) {
    var p = SF.Player;
    var dx = e.x - p.x, dy = e.y - p.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (!(projSpeed > 0) || !(dist > 0)) return null;
    var t = dist / projSpeed; // projectile travel time (s)
    return {
      x: e.x + (e.vx || 0) * t,
      y: e.y + (e.vy || 0) * t,
      dist: dist
    };
  }

  /* ---------------- DOM / canvas ---------------- */

  function ensureDom() {
    if (built) return;
    built = true;
    cv = document.createElement('canvas');
    cv.id = 'lock-overlay';
    cv.style.cssText = 'position:fixed;inset:0;z-index:17;pointer-events:none;';
    document.body.appendChild(cv);
    g = cv.getContext('2d');
    sizeCanvas();
    ensureLockButton();
    ensureKeybind();
  }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = Math.floor(vw * dpr), H = Math.floor(vh * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function shortName() {
    var n = lock ? targetName(lock) : '';
    return n.length > NAME_MAX ? n.slice(0, NAME_MAX - 1) + '…' : n;
  }

  function paintButton() {
    if (!lockBtn) return;
    var on = !!lock;
    lockBtn.classList.toggle('locked', on);
    lockBtn.textContent = on ? '🎯 ' + shortName() + ' [L]' : '🎯 LOCK [L]';
  }

  function ensureLockButton() {
    if (lockBtn) return;
    var css = document.getElementById('lock-css');
    if (!css) {
      css = document.createElement('style');
      css.id = 'lock-css';
      css.textContent =
        '#btn-targetlock.locked{border-color:#ff5e3a;color:#ffb59f;' +
        'box-shadow:0 0 10px rgba(255,94,58,.55)}';
      document.head.appendChild(css);
    }
    var hbb = document.getElementById('hud-buttons');
    if (!hbb) return;
    lockBtn = document.createElement('button');
    lockBtn.id = 'btn-targetlock';
    lockBtn.className = 'btn small ui-block';
    lockBtn.addEventListener('click', function () {
      if (window.SF && SF.Audio) SF.Audio.unlock();
      cycle();
    });
    hbb.appendChild(lockBtn);
    paintButton();
  }

  function photoActive() {
    try {
      return !!(window.SF && SF.PhotoMode && SF.PhotoMode.active &&
        SF.PhotoMode.active());
    } catch (e) { return false; }
  }

  function ensureKeybind() {
    if (window._targetlockKeyBound) return;
    window._targetlockKeyBound = true;
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyL') return;
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
      /* photo mode owns L while active (letterbox toggle) — stay out */
      if (photoActive()) return;
      cycle();
    });
  }

  /* ---------------- per-frame ---------------- */

  function updateCam(vw, vh) {
    var sys = SF.Game.systemId;
    if (sys !== lastSys) { rcx = null; lastSys = sys; }
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016;
    lastT = now;
    if (rcx === null) { rcx = SF.Player.x - vw / 2; rcy = SF.Player.y - vh / 2; }
    var k = Math.min(1, 6 * dt); // same follow-lerp as main.js / SF.Tracker
    rcx += (SF.Player.x - vw / 2 - rcx) * k;
    rcy += (SF.Player.y - vh / 2 - rcy) * k;
  }

  function hullFrac(e) {
    var m = e.maxHp > 0 ? e.maxHp : 1;
    return Math.max(0, Math.min(1, e.hp / m));
  }

  function hullColor(f) {
    return f > 0.5 ? '#3ddc5f' : (f > 0.25 ? '#ffcf5e' : '#ff5e3a');
  }

  function intersectRect(cx, cy, ang, vw, vh, m) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var tx = dx > 0 ? (vw - m - cx) / dx : (dx < 0 ? (m - cx) / dx : Infinity);
    var ty = dy > 0 ? (vh - m - cy) / dy : (dy < 0 ? (m - cy) / dy : Infinity);
    var t = Math.min(tx, ty);
    if (!isFinite(t) || t < 0) t = 0;
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function drawReticle(sx, sy, us, t) {
    var r = ((lock.radius || 14) + 14) * us;
    g.save();
    g.strokeStyle = LOCK_COLOR;
    g.lineWidth = 2.5 * us;
    g.globalAlpha = 0.95;
    /* four corner brackets, slow rotation */
    var rot = t * 0.6;
    var c = 0.42; // corner half-arc (rad)
    for (var i = 0; i < 4; i++) {
      var a = rot + i * Math.PI / 2;
      g.beginPath();
      g.arc(sx, sy, r, a - c, a + c);
      g.stroke();
    }
    /* center tick */
    g.beginPath();
    g.moveTo(sx - 3 * us, sy); g.lineTo(sx + 3 * us, sy);
    g.moveTo(sx, sy - 3 * us); g.lineTo(sx, sy + 3 * us);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }

  function drawLabel(sx, sy, us, t, below) {
    var dist = Math.hypot(lock.x - SF.Player.x, lock.y - SF.Player.y);
    var name = targetName(lock);
    var f = hullFrac(lock);
    var dTxt = fmtDist(dist);

    /* name */
    g.fillStyle = LOCK_COLOR;
    g.font = 'bold ' + Math.round(13 * us) + 'px monospace';
    g.textAlign = 'center';
    g.fillText(name, sx, below - 26 * us);

    /* hull bar */
    var bw = 92 * us, bh = 7 * us;
    var bx = sx - bw / 2, by = below - 20 * us;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = hullColor(f);
    g.fillRect(bx, by, bw * f, bh);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    /* distance */
    g.fillStyle = '#dfe9ff';
    g.font = Math.round(12 * us) + 'px monospace';
    g.fillText(dTxt, sx, below + 2 * us);
  }

  function drawPip(sx, sy, us, t) {
    var pulse = 0.5 + 0.5 * Math.sin(t * 7);
    var r = (7 + pulse * 2.5) * us;
    g.save();
    g.translate(sx, sy);
    g.rotate(Math.PI / 4);
    g.fillStyle = PIP_COLOR;
    g.globalAlpha = 0.9;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.rect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
    g.fill();
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }

  function paint() {
    ensureDom();
    sizeCanvas();
    var vw = window.innerWidth, vh = window.innerHeight;
    g.clearRect(0, 0, vw, vh);
    if (!window.SF || !SF.Game || !SF.Player) return;
    if (SF.Game.state !== 'PLAYING') return;
    /* photo mode hides all HUD chrome — this overlay included */
    if (photoActive()) return;

    if (!lock) acquire();      // auto-lock: nearest hostile to the crosshair
    else lockTick();           // validate: death / out-of-range breaks
    updateCam(vw, vh);
    paintButton();
    if (!lock) return;

    var t = nowS();
    var us = uiScale();
    var sx = lock.x - rcx, sy = lock.y - rcy;
    var m = 70 * us;

    if (sx > m && sx < vw - m && sy > m && sy < vh - m) {
      /* onscreen: reticle + name/hull/distance */
      drawReticle(sx, sy, us, t);
      var labelBase = sy + (lock.radius || 14) * us + 30 * us;
      drawLabel(sx, sy, us, t, labelBase);

      /* predictive lead pip — projectile-class weapons only */
      var w = weaponStats();
      if (w && PROJECTILE_KINDS[w.kind] && w.projectileSpeed > 0) {
        var lp = pipPoint(lock, w.projectileSpeed);
        if (lp) {
          var psx = lp.x - rcx, psy = lp.y - rcy;
          /* faint tether from the reticle to the pip */
          g.save();
          g.strokeStyle = PIP_COLOR;
          g.globalAlpha = 0.35;
          g.lineWidth = 1.5 * us;
          g.setLineDash([4 * us, 4 * us]);
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(psx, psy); g.stroke();
          g.restore();
          g.globalAlpha = 1;
          drawPip(psx, psy, us, t);
        }
      }
    } else {
      /* offscreen: edge arrow + name + distance (quest-tracker style) */
      var cx = vw / 2, cy = vh / 2;
      var ang = Math.atan2(sy - cy, sx - cx);
      var pp = intersectRect(cx, cy, ang, vw, vh, m);
      g.save();
      g.translate(pp.x, pp.y);
      g.rotate(ang);
      var s = 16 * us;
      g.fillStyle = LOCK_COLOR;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s, 0); g.lineTo(-s * 0.6, -s * 0.7); g.lineTo(-s * 0.6, s * 0.7);
      g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = LOCK_COLOR;
      g.font = 'bold ' + Math.round(12 * us) + 'px monospace';
      g.textAlign = 'center';
      var dist = Math.hypot(lock.x - SF.Player.x, lock.y - SF.Player.y);
      var tx = pp.x - Math.cos(ang) * 40 * us;
      var ty = pp.y - Math.sin(ang) * 40 * us + 4;
      g.fillText(targetName(lock) + ' · ' + fmtDist(dist), tx, ty);
    }
  }

  /* ---------------- hooks (additive, idempotent) ---------------- */

  function wrapUpdate() {
    if (!window.SF || !SF.HUD || typeof SF.HUD.update !== 'function') return false;
    if (SF.HUD.update._targetlockWrapped) return true;
    var orig = SF.HUD.update;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { paint(); } catch (e) {}
      return r;
    };
    w._targetlockWrapped = true;
    SF.HUD.update = w;
    return true;
  }

  /* SF.HUD is defined in this same file (above), so the wrap lands
   * immediately; the retry covers a hypothetical load-order race. */
  if (!wrapUpdate() && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (wrapUpdate()) clearInterval(iv); }, 500);
  }

  return {
    /* public / test API */
    current: function () { return lock; },
    cycle: cycle,
    clear: function () { clearLock(); },
    acquire: acquire,
    state: function () {
      var d = null, name = null, hp = null, mhp = null;
      if (lock) {
        name = targetName(lock);
        hp = lock.hp; mhp = lock.maxHp;
        d = Math.hypot(lock.x - SF.Player.x, lock.y - SF.Player.y);
      }
      return {
        locked: !!lock, name: name, hp: hp, maxHp: mhp, dist: d,
        candidates: candidates().length,
        range: LOCK_RANGE, arc: ARC
      };
    },
    _debug: function () {
      var vw = window.innerWidth, vh = window.innerHeight;
      var out = {
        state: this.state(),
        pip: null,
        weaponKind: null, weaponSpeed: null,
        targetScreen: null, pipScreen: null
      };
      var w = weaponStats();
      if (w) { out.weaponKind = w.kind; out.weaponSpeed = w.projectileSpeed; }
      if (lock) {
        out.targetScreen = {
          x: Math.round(lock.x - rcx), y: Math.round(lock.y - rcy)
        };
        if (w && PROJECTILE_KINDS[w.kind] && w.projectileSpeed > 0) {
          var lp = pipPoint(lock, w.projectileSpeed);
          if (lp) {
            out.pip = { x: lp.x, y: lp.y, dist: lp.dist };
            out.pipScreen = { x: Math.round(lp.x - rcx), y: Math.round(lp.y - rcy) };
          }
        }
      }
      return out;
    },
    _candidates: candidates,
    _isHostile: isHostile
  };
})();

/* ================= combat-text-feed phase (2026-10-20) =================
 * Floating combat event feed: the last 4 combat events (crit hits, kills,
 * pickups, warnings) render as small text lines fading over ~3s, stacked
 * above the slim weapon chip (#weapon-btn lives at top:114px left:8px; the
 * feed grows upward from y=166px on the left edge). Newest line sits at the
 * bottom of the stack, closest to the weapon chip.
 *
 * New API: SF.HUD.combatFeed(text, kind)
 *   kind: 'crit' | 'kill' | 'pickup' | 'warn' (anything else -> 'kill')
 *
 * Auto-hooks (all additive, idempotent, hud.js-only — no other file edited):
 *  - SF.Enemies.kill wrap      -> '☠ <name> destroyed'            (kill)
 *  - SF.FX.damageNumber wrap   -> 'CRIT <n>' when opts.crit        (crit)
 *  - SF.Pickups.update wrap    -> '+<n> credits' / '+<n> ore'      (pickup)
 *    (credits/ore deltas detected across the wrapped update call)
 *  - SF.HUD.toast wrap         -> weapon/mod/part/item pickup toasts
 *    ('⚔ Weapon acquired:', '⚙ Mod acquired:', 'Salvaged part:',
 *     'Salvaged:', 'Duplicate ')                                   (pickup)
 *  - SF.Player.takeDamage outer wrap -> '⚠ SHIELDS DOWN' on shield break,
 *    '⚠ HULL CRITICAL <pct>%' on first crossing below 25% hull  (warn);
 *    hull warning re-arms when repaired above 50%; both reset on new game.
 *
 * Quality tiers: SF.FX.getEffective() === 'low' turns the feed OFF —
 * combatFeed() is a no-op and the container hides (no backlog accumulates).
 * Save-neutral: runtime only, no SAVE_VERSION bump, no save-blob changes.
 * Photo mode: 'combat-feed' is registered in SF.PhotoMode.CHROME (same file)
 * so clean frames stay clean. SF.Codex / the 'C' hotkey (js/campaign.js,
 * loads after this file) are untouched.
 */
window.SF = window.SF || {};

SF.CombatFeed = (function () {
  'use strict';

  var MAX_LINES = 4;
  var FADE_S = 3.0;
  var LINE_PX = 22;
  var COLORS = { crit: '#ff9500', kill: '#ff8c7a', pickup: '#3fe0c3', warn: '#ff3b30' };
  var PICKUP_PREFIXES = ['⚔ Weapon acquired:', '⚙ Mod acquired:', 'Salvaged part:',
                         'Salvaged:', 'Duplicate '];

  var lines = [];   /* {text, kind, t0} — newest last */
  var box = null, rowEls = [];
  var hullWarned = false;
  var hooked = false;
  var feedSnap = { c: 0, o: 0 };

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  function lowQ() {
    try {
      return !!(window.SF && SF.FX && SF.FX.getEffective &&
        SF.FX.getEffective() === 'low');
    } catch (e) { return false; }
  }

  function snapPlayer() {
    try {
      feedSnap.c = Math.floor(SF.Player.credits || 0);
      feedSnap.o = Math.floor(SF.Player.ore || 0);
    } catch (e) {}
  }

  function ensureDom() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'combat-feed';
    /* directly above the slim weapon chip (top:114px, ~44px tall): the stack
     * grows upward from y=166px, newest line at the bottom near the chip. */
    box.style.cssText = 'position:fixed;left:8px;' +
      'top:calc(166px + env(safe-area-inset-top));z-index:20;pointer-events:none;' +
      'display:flex;flex-direction:column;justify-content:flex-end;' +
      'height:' + (MAX_LINES * LINE_PX) + 'px;width:44vw;max-width:320px;';
    for (var i = 0; i < MAX_LINES; i++) {
      var d = document.createElement('div');
      d.style.cssText = 'font:bold 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'letter-spacing:.5px;color:#fff;' +
        'text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.8);' +
        'height:' + LINE_PX + 'px;line-height:' + LINE_PX + 'px;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;opacity:0;';
      box.appendChild(d);
      rowEls.push(d);
    }
    document.body.appendChild(box);
  }

  function push(text, kind) {
    if (!text) return;
    if (lowQ()) return; /* Low tier: feed off — no backlog accumulates */
    if (!COLORS[kind]) kind = 'kill';
    lines.push({ text: String(text), kind: kind, t0: nowS() });
    while (lines.length > MAX_LINES) lines.shift();
  }

  function paint() {
    ensureDom();
    if (lowQ()) { box.style.display = 'none'; return; }
    var t = nowS();
    while (lines.length && t - lines[0].t0 >= FADE_S) lines.shift();
    var st = (window.SF && SF.Game) ? SF.Game.state : null;
    var show = (st === 'PLAYING' || st === 'GAMEOVER');
    box.style.display = show ? '' : 'none';
    if (!show) return;
    var n = lines.length;
    for (var i = 0; i < MAX_LINES; i++) {
      var row = rowEls[i], L = lines[i];
      if (!L) { row.style.opacity = '0'; row.textContent = ''; continue; }
      var age = t - L.t0;
      var base = Math.max(0, 1 - age / FADE_S);
      /* oldest fades first: age already drives this, plus a mild recency
       * weighting so the newest line reads brightest. */
      var op = base * (n > 1 ? (0.55 + 0.45 * (i + 1) / n) : 1);
      row.textContent = L.text;
      row.style.color = COLORS[L.kind];
      row.style.opacity = op.toFixed(3);
    }
  }

  function enemyName(e) {
    try {
      if (e.eliteName) return e.eliteName;
      if (e.bossDef && e.bossDef.title) return e.bossDef.title;
      if (e.spec && (e.spec.scoreName || e.spec.name)) return e.spec.scoreName || e.spec.name;
    } catch (x) {}
    return (e && e.type) || 'hostile';
  }

  function wrap(obj, name, flag, fn) {
    if (!obj) return false;
    var orig = obj[name];
    if (typeof orig !== 'function' || orig[flag]) return true;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { fn.apply(this, arguments); } catch (e) {}
      return r;
    };
    w[flag] = true;
    /* propagate other phases' idempotency flags: several phases re-check
     * their flag on an interval (e.g. SF.DamageFX re-hooks takeDamage every
     * 3s, SF.Finisher guards kill with __fks). Without propagation they see
     * a "fresh" outer function and stack a duplicate layer over us. */
    for (var k in orig) {
      if (k.charAt(0) === '_' && !(k in w) && typeof orig[k] !== 'function') {
        try { w[k] = orig[k]; } catch (pe) {}
      }
    }
    obj[name] = w;
    return true;
  }

  /* per-hook completion flags: installAll retries every 500ms until every
   * hook lands (SF.Game lives in main.js, parsed after this file). The
   * flags — not the wrapper-function flags — are the retry guard, because a
   * later phase may wrap OVER us (SF.Finisher wraps kill at runtime), hiding
   * our function flag and causing a duplicate layer on retry. */
  var doneKill = false, doneCrit = false, donePickup = false,
      doneToast = false, doneDmg = false, doneReset = false;

  function hookAll() {
    if (!window.SF) return false;

    /* kills */
    if (!doneKill && SF.Enemies) doneKill = wrap(SF.Enemies, 'kill', '_combatFeedWrapped', function (e) {
      push('☠ ' + enemyName(e) + ' destroyed', 'kill');
    });

    /* crits (stacks with the damage-numbers wrap on the same point) */
    if (!doneCrit && SF.FX) doneCrit = wrap(SF.FX, 'damageNumber', '_combatFeedWrapped', function (x, y, amount, opts) {
      if (opts && opts.crit) push('CRIT ' + Math.round(+amount || 0), 'crit');
    });

    /* pickup credit/ore deltas across the per-frame update */
    if (!donePickup && SF.Pickups && SF.Player) donePickup = wrap(SF.Pickups, 'update', '_combatFeedWrapped',
      function (dt, player) {
        var p = player || SF.Player;
        var c0 = feedSnap.c, o0 = feedSnap.o;
        var c1 = Math.floor(p.credits || 0), o1 = Math.floor(p.ore || 0);
        feedSnap.c = c1; feedSnap.o = o1;
        if (c1 > c0) push('+' + (c1 - c0).toLocaleString('en-US') + ' credits', 'pickup');
        if (o1 > o0) push('+' + (o1 - o0) + ' ore', 'pickup');
      });

    /* weapon / mod / part / item pickup toasts */
    if (!doneToast && SF.HUD) doneToast = wrap(SF.HUD, 'toast', '_combatFeedWrapped', function (msg) {
      var m = String(msg || '');
      for (var i = 0; i < PICKUP_PREFIXES.length; i++) {
        if (m.indexOf(PICKUP_PREFIXES[i]) === 0) { push(m, 'pickup'); break; }
      }
    });

    hooked = doneKill && doneCrit && donePickup && doneToast;
    return hooked;
  }

  /* takeDamage outer wrap: applied LAST so it runs FIRST on call and sees
   * pre-damage shield/hull values. Handles '⚠ SHIELDS DOWN' + the
   * '⚠ HULL CRITICAL' first-crossing (re-arms above 50% hull). */
  function installDamageWrap() {
    if (doneDmg) return true;
    if (!window.SF || !SF.Player || typeof SF.Player.takeDamage !== 'function') return false;
    var orig = SF.Player.takeDamage;
    if (orig._combatFeedOuter) { doneDmg = true; return true; }
    var w = function (dmg) {
      var P = SF.Player, sb = 0, hb = 0, mh = 0, alive = false;
      try {
        sb = P.shield; hb = P.hull; alive = !!P.alive;
        mh = (typeof P.maxHull === 'function') ? P.maxHull() : 0;
      } catch (e) {}
      var r = orig.call(this, dmg);
      try {
        if (alive && sb > 0 && P.shield <= 0) push('⚠ SHIELDS DOWN', 'warn');
        if (mh > 0) {
          var hf = P.hull / mh;
          if (hf < 0.25 && !hullWarned) {
            hullWarned = true;
            push('⚠ HULL CRITICAL ' + Math.round(Math.max(0, hf) * 100) + '%', 'warn');
          } else if (hf > 0.5) {
            hullWarned = false; /* re-arm when repaired above half */
          }
        }
      } catch (e2) {}
      return r;
    };
    w._combatFeedOuter = true;
    /* same flag-propagation rationale as wrap(): keep other phases'
     * re-hook guards (e.g. SF.DamageFX's 3s takeDamage re-hook) satisfied */
    for (var k2 in orig) {
      if (k2.charAt(0) === '_' && !(k2 in w) && typeof orig[k2] !== 'function') {
        try { w[k2] = orig[k2]; } catch (pe2) {}
      }
    }
    SF.Player.takeDamage = w;
    doneDmg = true;
    return true;
  }

  /* hull-warning + line reset on new game */
  function installNewGameReset() {
    if (doneReset) return true;
    if (!window.SF || !SF.Game || typeof SF.Game.newGame !== 'function') return false;
    wrap(SF.Game, 'newGame', '_combatFeedResetWrapped', function () {
      hullWarned = false;
      lines.length = 0;
      snapPlayer();
    });
    doneReset = true;
    return true;
  }

  /* retry loop: hud.js parses before main.js defines SF.Game, so SF.Game /
   * SF.Player methods may not exist yet on first pass. */
  function installAll() {
    snapPlayer();
    var a = hookAll();
    var b = installDamageWrap();
    var c = installNewGameReset();
    return a && b && c;
  }

  /* per-frame paint rides SF.HUD.update (same convention as SF.NavMarks);
   * a 150ms interval keeps the 3s fade smooth when update isn't running. */
  try {
    wrap(SF.HUD, 'update', '_combatFeedPaintWrapped', function () { paint(); });
  } catch (e) {}
  if (typeof setInterval !== 'undefined' && !window._combatFeedInterval) {
    window._combatFeedInterval = setInterval(paint, 150);
  }
  if (!installAll() && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (installAll()) clearInterval(iv); }, 500);
  }

  return {
    /* ---- public: SF.HUD.combatFeed delegates here ---- */
    push: function (text, kind) {
      if (lowQ()) return false; /* Low tier: feed off, no backlog */
      var before = lines.length;
      push(text, kind);
      return lines.length > before;
    },
    state: function () {
      var t = nowS();
      return {
        lines: lines.map(function (L) {
          return { text: L.text, kind: L.kind, age: +(t - L.t0).toFixed(2) };
        }),
        count: lines.length,
        lowQ: lowQ(),
        hooked: hooked
      };
    },
    clear: function () { lines.length = 0; },
    MAX_LINES: MAX_LINES,
    FADE_S: FADE_S,
    /* ---- test hooks ---- */
    _debug: function () {
      ensureDom();
      var t = nowS();
      return {
        rows: rowEls.map(function (row, i) {
          var L = lines[i];
          return {
            text: row.textContent,
            color: row.style.color,
            opacity: parseFloat(row.style.opacity) || 0,
            kind: L ? L.kind : null,
            age: L ? +(t - L.t0).toFixed(2) : null
          };
        }),
        domLines: lines.length,
        lowQ: lowQ(),
        visible: box.style.display !== 'none'
      };
    },
    _paint: paint,
    _hook: installAll
  };
})();

/* combat-text-feed: public API on SF.HUD (Low tier = feed off). */
SF.HUD.combatFeed = function (text, kind) {
  if (window.SF && SF.CombatFeed) return SF.CombatFeed.push(text, kind);
  return false;
};

/* ================= threat-ring-legend phase (2026-10-21) =================
 * SF.ThreatLegend: QoL legend for the minimap threat rings, requested in the
 * minimap-threat-rings report. Toggleable legend panel drawn as a canvas
 * overlay on the minimap (bottom-left corner), next to the existing rings.
 *
 *  - orange = elite, red = boss, purple = hunter
 *  - Classification REUSES SF.ThreatRings.kindOf (priority hunter > boss >
 *    elite) — no re-implementation; colors come from
 *    SF.ThreatRings.colors(); the legend swatch pulse reuses
 *    SF.ThreatRings.pulseRate(dist) on the nearest live threat of that kind.
 *  - Rows show a live count of that threat class on the current minimap;
 *    kinds with zero live threats render dimmed (still visible, so the
 *    color key is always readable).
 *  - Toggle: a tiny DOM chip ('⚠') pinned to the minimap corner. The canvas
 *    itself is pointer-events:none (see css/style.css #minimap), so a
 *    canvas-hit-test toggle would never receive taps; a DOM chip inside
 *    #hud-minimap-wrap (pointer-events:auto, absolute) is the reliable route.
 *    Persisted in localStorage 'starfall_threat_legend_v1' — save-neutral,
 *    no SAVE_VERSION bump.
 *
 * Scope: js/hud.js only. Two hook lines in SF.HUD (drawMinimap tail,
 * init after mmctx setup). Everything else additive + idempotent.
 *
 * Test hooks: toggle(), isExpanded(), liveCounts(), colors(), lastRect().
 */
SF.ThreatLegend = (function () {
  'use strict';

  var KEY = 'starfall_threat_legend_v1';
  var KINDS = ['elite', 'boss', 'hunter'];
  var LABELS = { elite: 'elite', boss: 'boss', hunter: 'hunter' };
  var ROW_H = 13, PANEL_W = 68, PAD = 3, HEADER_H = 12;

  var expanded = true;   // default: legend visible
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s.expanded === 'boolean') expanded = s.expanded;
    }
  } catch (e) { /* storage unavailable: default on */ }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ expanded: expanded })); } catch (e) {}
  }

  function colors() {
    if (window.SF && SF.ThreatRings && typeof SF.ThreatRings.colors === 'function') {
      return SF.ThreatRings.colors();
    }
    return { elite: '#ff9d2e', boss: '#ff2e1f', hunter: '#b45cff' };
  }

  /* Classify live enemies into threat kinds, reusing
   * SF.ThreatRings.kindOf — the single source of truth for
   * elite/boss/hunter priority. Returns {elite:[...],boss:[...],hunter:[...]} */
  function liveKinds() {
    var out = { elite: [], boss: [], hunter: [] };
    try {
      if (!window.SF || !SF.ThreatRings || typeof SF.ThreatRings.kindOf !== 'function' ||
          !SF.Enemies || !SF.Enemies.list) return out;
      var kindOf = SF.ThreatRings.kindOf;
      var list = SF.Enemies.list;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || e.dead) continue;
        var k = kindOf(e);
        if (k && out[k]) out[k].push(e);
      }
    } catch (e) { /* render path must never throw */ }
    return out;
  }

  function liveCounts() {
    var c = { elite: 0, boss: 0, hunter: 0 };
    try {
      var lk = liveKinds();
      for (var i = 0; i < KINDS.length; i++) c[KINDS[i]] = lk[KINDS[i]].length;
    } catch (e) {}
    return c;
  }

  function nearestDist(lk, kind) {
    try {
      if (!window.SF || !SF.Player) return 4000;
      var px = SF.Player.x, py = SF.Player.y, best = Infinity, i, e;
      var arr = lk[kind];
      for (i = 0; i < arr.length; i++) {
        e = arr[i];
        var d = Math.hypot(e.x - px, e.y - py);
        if (d < best) best = d;
      }
      return best === Infinity ? 4000 : best;
    } catch (e) { return 4000; }
  }

  var lastRect = null; // canvas-px rect of the painted panel, for test hooks

  function paint(ctx, w, h) {
    if (!ctx || w <= 0 || h <= 0) return;
    if (!expanded) { lastRect = null; return; }
    if (!window.SF || !SF.ThreatRings) return; // no rings module -> no legend
    var cols = colors();
    var lk = liveKinds();
    var panelH = HEADER_H + KINDS.length * ROW_H + PAD;
    var x = 2, y = h - panelH - 2;

    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = 'rgba(4,8,20,0.9)';
    roundRectPath(ctx, x, y, PANEL_W, panelH, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120,160,220,0.55)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, PANEL_W, panelH, 4);
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.font = '700 8px monospace';
    ctx.fillStyle = '#9fb6d8';
    ctx.fillText('THREAT', x + 6, y + 3);

    var now = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) / 1000;
    var pulseRate = (SF.ThreatRings && typeof SF.ThreatRings.pulseRate === 'function')
      ? SF.ThreatRings.pulseRate : null;

    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var n = lk[k].length;
      var ry = y + HEADER_H + i * ROW_H;
      ctx.globalAlpha = n > 0 ? 1 : 0.42;
      /* swatch: small dot that pulses with the same rate as the live
       * rings of that kind (reuses SF.ThreatRings.pulseRate). */
      var rate = pulseRate ? pulseRate(nearestDist(lk, k)) : 0;
      var pr = 2.6 + 1.1 * Math.sin(now * rate);
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      ctx.arc(x + 10, ry + ROW_H / 2 - 1, Math.max(1.6, pr), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '9px monospace';
      ctx.fillStyle = '#dfe9ff';
      var label = LABELS[k] + (n > 0 ? ' x' + n : '');
      ctx.fillText(label, x + 18, ry + 2);
    }
    ctx.restore();
    lastRect = { x: x, y: y, w: PANEL_W, h: panelH };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- DOM chip ---------- */

  var chipInstalled = false;

  function toggle() {
    expanded = !expanded;
    persist();
    if (window.SF && SF.Audio && typeof SF.Audio.ui === 'function') {
      try { SF.Audio.ui(); } catch (e) {}
    }
    return expanded;
  }

  function paintChip() {
    var c = document.getElementById('threat-legend-chip');
    if (c) {
      c.textContent = '⚠';
      c.style.opacity = expanded ? '1' : '0.55';
      c.title = expanded ? 'hide threat legend' : 'show threat legend';
    }
  }

  function install() {
    if (chipInstalled || typeof document === 'undefined') return;
    var wrap = document.getElementById('hud-minimap-wrap');
    if (!wrap) return;
    chipInstalled = true;
    if (!document.getElementById('legend-chip-css')) {
      var css = document.createElement('style');
      css.id = 'legend-chip-css';
      /* The wrap and the canvas are pointer-events:none (game taps pass
       * through); the chip re-enables pointer events for itself only so a
       * 120px canvas doesn't swallow aiming taps. */
      css.textContent =
        '#threat-legend-chip{position:absolute;top:0;right:0;z-index:5;' +
        'pointer-events:auto;width:24px;height:24px;padding:0;border-radius:6px;' +
        'border:1px solid rgba(120,160,220,.6);background:rgba(6,12,26,.85);' +
        'color:#ffd23f;font-size:13px;line-height:1;cursor:pointer}';
      document.head.appendChild(css);
    }
    var chip = document.createElement('button');
    chip.id = 'threat-legend-chip';
    chip.className = 'ui-block';
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (window.SF && SF.Audio && typeof SF.Audio.unlock === 'function') SF.Audio.unlock();
      toggle();
      paintChip();
    });
    wrap.appendChild(chip);
    paintChip();
  }

  return {
    install: install,
    paint: paint,
    toggle: toggle,
    setExpanded: function (v) { expanded = !!v; persist(); paintChip(); return expanded; },
    isExpanded: function () { return expanded; },
    liveCounts: liveCounts,
    colors: colors,
    lastRect: function () { return lastRect; },
    key: KEY // test hook: localStorage key
  };
})();

/* ================= hud-cooldown-pips phase (2026-10-21) =================
 * SF.CooldownPips: canvas-drawn cooldown pips under the #weapon-btn chip.
 * Purely visual reads of existing cooldown state — NO gameplay changes.
 *
 * Pips (fixed slots, drawn left→right under the weapon button):
 *  - FIRE : primary weapon fire cooldown. Hooked via SF.Audio.weaponSound,
 *           which is called ONLY from the player fire block (ship.js) — enemy
 *           fire uses enemyLaser, wingmen never call it. Interval is recomputed
 *           per shot: (1 / (fireRate * SF.Mods.rateMul(entry))) * crew cooldownMul.
 *  - PING : survey ping cooldown (SF.Survey: 2s).
 *  - DRONE: salvage-drone module pip (SF.Drone) — shown only when owned.
 *           Deployed: tracks 45s sweep timeLeft. Recalled/destroyed: tracks
 *           the 60s redeploy cooldown.
 *  - REACT: power-profile switch cooldown (3s) — shown only while cooling.
 * Heat gauge: horizontal bar under the pip row, shown while heat > 1% or
 * venting (Overdrive profile). Vent countdown included.
 *
 * NOTE on "active mod cooldowns": weapon mods (SF.Mods) are passive loot
 * multipliers with no timers — there are no mod cooldowns to read. The
 * active-module slots (drone deployable + survey ping) are the game's real
 * timed active systems and are what these pips cover.
 *
 * Rendering: dedicated overlay canvas (z-index 14, pointer-events:none),
 * dpr-aware like the tracker overlay. Positions anchor to #weapon-btn's
 * live rect, clamped to the viewport with 8px margins — portrait-safe at
 * 390x844, landscape-safe at 844x390. 44px pips (touch-safe size, though the
 * pips are display-only). Save-neutral: no save fields, no SAVE_VERSION bump.
 *
 * Test hook: snapshot() returns pip/heat/layout data in CSS pixels so
 * headless smoke tests can assert fractions, positions and viewport bounds
 * without pixel reads. lastInterval() returns the ms fire interval used by
 * the last shot.
 */
SF.CooldownPips = (function () {
  'use strict';

  var PIP = 44, GAP = 10, MARGIN = 8, LABEL = 12;
  var cv = null, g = null, dpr = 1;
  var hooked = false;
  var lastShotAt = -Infinity, lastIntervalMs = 0, lastWid = '';

  function nowMs() {
    return (typeof performance !== 'undefined') ? performance.now() : Date.now();
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------- shot hook ---------------- */

  function fireIntervalMs(wid) {
    try {
      var wcfg = window.SF && SF.CONFIG && SF.CONFIG.weapons && SF.CONFIG.weapons[wid];
      if (!wcfg || !wcfg.fireRate) return 500;
      var entry = (SF.Player && typeof SF.Player.currentWeaponEntry === 'function')
        ? SF.Player.currentWeaponEntry() : null;
      var rate = wcfg.fireRate * (window.SF && SF.Mods ? SF.Mods.rateMul(entry) : 1);
      var cdMul = 1;
      if (window.SF && SF.Crew && typeof SF.Crew.recalcPerks === 'function') {
        var p = SF.Crew.recalcPerks(SF.Player);
        if (p && p.cooldownMul > 0) cdMul = p.cooldownMul;
      }
      if (!(rate > 0)) return 500;
      return Math.max(40, (1000 / rate) * cdMul);
    } catch (e) { return 500; }
  }

  function onShot(wid) {
    lastWid = wid || '';
    lastIntervalMs = fireIntervalMs(lastWid);
    lastShotAt = nowMs();
  }

  function hookShot() {
    if (hooked) return;
    if (!window.SF || !SF.Audio || typeof SF.Audio.weaponSound !== 'function') return;
    var orig = SF.Audio.weaponSound;
    if (typeof orig !== 'function' || orig._pipsWrapped) { hooked = true; return; }
    var w = function (wid) {
      var r = orig.apply(this, arguments);
      try { onShot(wid); } catch (e) {}
      return r;
    };
    w._pipsWrapped = true;
    SF.Audio.weaponSound = w;
    hooked = true;
  }

  /* ---------------- DOM / canvas ---------------- */

  function ensureDom() {
    hookShot();
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'cooldown-pips-overlay';
    cv.style.cssText = 'position:fixed;inset:0;z-index:14;pointer-events:none;';
    document.body.appendChild(cv);
    g = cv.getContext('2d');
    sizeCanvas();
  }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = Math.floor(vw * dpr), H = Math.floor(vh * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /* ---------------- state reads ---------------- */

  function reactorState() {
    try {
      return (window.SF && SF.Player && typeof SF.Player.reactorState === 'function')
        ? SF.Player.reactorState() : null;
    } catch (e) { return null; }
  }

  /* hud-declutter-1: the ship.js subsystem cluster (drawSubsysCluster)
   * paints its 5 integrity bars starting 8px below the lowest of
   * #bars/#btn-menu/#weapon-btn, i.e. in EXACTLY the row this pip row
   * used to anchor to — the user's screenshots show the pip discs and
   * the PING caption painted over the rainbow bars. ship.js is outside
   * this phase's scope, so reserve its zone here: cluster top =
   * max-bottom + 8, height = 5 bars x 13px pitch - 4 = 61px. */
  function subsysZone() {
    try {
      if (!window.SF || !SF.Player) return null;
      /* hud-dup-fix: reserve space ONLY for what drawSubsysCluster
       * actually painted. Since hud-declutter-2 the cluster paints
       * NOTHING on a pristine ship, but this zone kept reserving the
       * full 5-bar block unconditionally — shoving the pip row ~65px
       * down into the left-stick zone, where the FIRE/PING discs read
       * as a second set of touch controls (user recording 2026-10-23).
       * ship.js exposes the real painted box via _subsysClusterDebug
       * (null box = nothing painted = no reservation). The legacy
       * DOM-measured estimate remains only as a fallback for builds
       * without that hook. */
      if (typeof SF.Player._subsysClusterDebug === 'function') {
        var dbg = SF.Player._subsysClusterDebug();
        if (!dbg || !dbg.box) return null;
        return { top: dbg.box.y, bottom: dbg.box.y + dbg.box.h };
      }
      if (typeof SF.Player.subsystems !== 'function') return null;
      if (!SF.SUBSYSTEMS || !SF.SUBSYSTEMS.length) return null;
      var W = window.innerWidth || 1280, y = 58;
      ['bars', 'btn-menu', 'weapon-btn'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (r.x > W / 2) return;
        if (r.bottom > y - 8) y = Math.round(r.bottom) + 8;
      });
      return { top: y, bottom: y + SF.SUBSYSTEMS.length * 13 - 4 };
    } catch (e) { return null; }
  }

  function snapshot() {
    var out = { pips: [], heat: { visible: false, frac: 0, vent: 0, heat: 0 },
                layout: null, playing: false, subsysZone: null };
    try {
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return out;
      out.playing = true;
      var p = SF.Player;
      if (!p) return out;
      var now = nowMs();

      /* FIRE pip — always present in PLAYING */
      var w = (typeof p.currentWeapon === 'function') ? p.currentWeapon() : null;
      var wid = w ? w.id : '';
      var ffrac = 1, fsecs = 0;
      if (wid && wid === lastWid && lastIntervalMs > 0) {
        var el = now - lastShotAt;
        ffrac = clamp(el / lastIntervalMs, 0, 1); // 0 at shot -> 1 when ready
        fsecs = Math.max(0, (lastIntervalMs - el) / 1000);
      }
      var fcolor = (w && window.SF && SF.TIERS && SF.TIERS[w.tier]) ? SF.TIERS[w.tier] : '#ffcf5e';
      out.pips.push({ id: 'fire', label: 'FIRE', icon: '\u26A1', color: fcolor,
                     frac: ffrac, secs: fsecs, visible: true });

      /* PING pip — survey ping (2s) */
      if (window.SF && SF.Survey && typeof SF.Survey.testState === 'function' &&
          typeof SF.Survey.COOLDOWN === 'number') {
        var st = SF.Survey.testState();
        var cd = Math.max(0, st.cooldown || 0), full = SF.Survey.COOLDOWN;
        out.pips.push({ id: 'ping', label: 'PING', icon: '\uD83D\uDCE1', color: '#39d5e8',
                        frac: full > 0 ? clamp(1 - cd / full, 0, 1) : 1,
                        secs: cd, visible: true });
      }

      /* DRONE pip — salvage-drone module, only when owned */
      if (window.SF && SF.Drone && typeof SF.Drone.owned === 'function' &&
          typeof SF.Drone.state === 'function' && SF.Drone.owned() > 0) {
        var ds = SF.Drone.state();
        var dcfg = (typeof SF.Drone.config === 'function') ? SF.Drone.config() : {};
        var dfrac = 1, dsecs = 0, dlabel = 'DRONE';
        if (ds.active) {
          var dt2 = Math.max(0, ds.timeLeft || 0), dfull = dcfg.deployT || 45;
          /* sweep duration: ring depletes 1 -> 0 as the 45s runs out */
          dfrac = dfull > 0 ? clamp(dt2 / dfull, 0, 1) : 1;
          dsecs = dt2; dlabel = 'DRONE';
        } else if (ds.cooldown > 0) {
          var cfull = dcfg.cooldownT || 60;
          dfrac = cfull > 0 ? clamp(1 - ds.cooldown / cfull, 0, 1) : 1;
          dsecs = ds.cooldown;
        }
        out.pips.push({ id: 'drone', label: dlabel, icon: '\uD83D\uDEF0', color: '#ffd23f',
                        frac: dfrac, secs: dsecs, visible: true,
                        active: !!ds.active });
      }

      /* REACT pip — power-profile switch cooldown, only while cooling */
      var R = reactorState();
      if (R && R.cooldown > 0.001) {
        var rfull = (window.SF && SF.REACTOR_SWITCH_COOLDOWN) || 3;
        var prof = (window.SF && SF.REACTOR_PROFILES && SF.REACTOR_PROFILES[R.profile]) || null;
        out.pips.push({ id: 'reactor', label: 'REACT', icon: '\u2699\uFE0F',
                        color: prof ? prof.color : '#8fd0ff',
                        frac: clamp(1 - R.cooldown / rfull, 0, 1),
                        secs: Math.max(0, R.cooldown), visible: true });
      }

      /* heat gauge — Overdrive heat while building, plus vent countdown */
      if (R && (R.heat > 1 || R.vent > 0)) {
        out.heat.visible = true;
        out.heat.heat = R.heat;
        out.heat.vent = R.vent;
        out.heat.frac = R.vent > 0 ? 1 : clamp(R.heat / 100, 0, 1);
      }

      /* layout: row anchored under #weapon-btn, clamped to the viewport */
      var vw = window.innerWidth, vh = window.innerHeight;
      var wb = document.getElementById('weapon-btn');
      var rect = wb ? wb.getBoundingClientRect() : null;
      var n = out.pips.length;
      var totalW = n * PIP + (n - 1) * GAP;
      var cx = rect ? (rect.left + rect.width / 2) : vw / 2;
      var x0 = clamp(cx - totalW / 2, MARGIN, Math.max(MARGIN, vw - MARGIN - totalW));
      var heatH = out.heat.visible ? 26 : 0;
      var rowH = PIP + LABEL + 6 + heatH;
      var y0 = rect ? (rect.bottom + 10) : 90;
      /* hud-declutter-1: never paint the pip row over the subsystem
       * cluster (see subsysZone) — drop below it with a 6px gap. */
      var szone = subsysZone();
      out.subsysZone = szone;
      if (szone && y0 < szone.bottom + 6 && y0 + rowH > szone.top - 6) {
        y0 = szone.bottom + 6;
      }
      y0 = clamp(y0, MARGIN, Math.max(MARGIN, vh - MARGIN - rowH));
      out.pips.forEach(function (pp, i) {
        pp.cx = Math.round((x0 + i * (PIP + GAP) + PIP / 2) * 10) / 10;
        pp.cy = Math.round((y0 + PIP / 2) * 10) / 10;
        pp.r = PIP / 2;
      });
      out.layout = { x0: Math.round(x0 * 10) / 10, y0: Math.round(y0 * 10) / 10,
                     totalW: totalW, rowH: rowH, vw: vw, vh: vh,
                     heatY: Math.round((y0 + PIP + LABEL + 6) * 10) / 10 };
    } catch (e) { /* render path must never throw */ }
    return out;
  }

  /* ---------------- paint ---------------- */

  function drawPip(pp) {
    var cx = pp.cx, cy = pp.cy, r = pp.r;
    g.save();
    /* disc */
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(6,12,26,0.78)'; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(120,150,190,0.4)'; g.stroke();
    /* ready sweep */
    if (pp.frac > 0.001) {
      g.beginPath();
      g.arc(cx, cy, r - 4, -Math.PI / 2, -Math.PI / 2 + pp.frac * Math.PI * 2);
      g.lineWidth = 5; g.strokeStyle = pp.color; g.lineCap = 'round'; g.stroke();
    }
    /* cooling dim */
    if (pp.frac < 1) {
      g.beginPath(); g.arc(cx, cy, r - 1, 0, Math.PI * 2);
      g.fillStyle = 'rgba(4,8,18,0.45)'; g.fill();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (pp.frac < 1) {
      g.font = 'bold 12px system-ui, sans-serif';
      g.fillStyle = '#fff';
      g.fillText(pp.secs < 10 ? pp.secs.toFixed(1) : Math.ceil(pp.secs) + '', cx, cy + 1);
    } else {
      g.font = '20px system-ui, sans-serif';
      g.fillText(pp.icon, cx, cy + 1);
    }
    /* label */
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = pp.frac < 1 ? '#ffd23f' : '#9db0cc';
    g.fillText(pp.label, cx, cy + r + 9);
    g.restore();
  }

  function drawHeat(snap) {
    var h = snap.heat, L = snap.layout;
    if (!h.visible || !L) return;
    var x = L.x0, y = L.heatY, w = L.totalW, bh = 8;
    g.save();
    g.fillStyle = 'rgba(6,12,26,0.78)';
    g.fillRect(x, y, w, bh);
    var col = h.vent > 0 ? '#ff4d6d' :
      (h.heat > 66 ? '#ff4d6d' : (h.heat > 33 ? '#ffd24d' : '#57d98a'));
    g.fillStyle = col;
    g.fillRect(x, y, Math.round(w * clamp(h.frac, 0, 1)), bh);
    g.strokeStyle = 'rgba(120,150,190,0.45)'; g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, bh - 1);
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = '#ff8d7a';
    var txt = h.vent > 0
      ? '\u2699 VENTING ' + h.vent.toFixed(1) + 's — stats halved'
      : 'HEAT ' + Math.round(h.heat) + '%';
    g.fillText(txt, x + w / 2, y + bh + 3);
    g.restore();
  }

  function paint() {
    try {
      ensureDom();
      sizeCanvas();
      g.clearRect(0, 0, window.innerWidth, window.innerHeight);
      var snap = snapshot();
      if (!snap.playing || !snap.pips.length) return;
      var i;
      for (i = 0; i < snap.pips.length; i++) drawPip(snap.pips[i]);
      drawHeat(snap);
    } catch (e) { /* render path must never throw */ }
  }

  return {
    paint: paint,
    snapshot: snapshot,
    subsysZone: subsysZone, // hud-declutter-1 test hook
    lastInterval: function () { return lastIntervalMs; },
    lastWeapon: function () { return lastWid; },
    _onShot: onShot, // test hook: simulate a player shot
    PIP: PIP
  };
})();

/* hud-cooldown-pips: drive the overlay from the main HUD update (additive). */
(function () {
  if (window.SF && SF.HUD && typeof SF.HUD.update === 'function' && !SF.HUD.update._pipsWrapped) {
    var orig = SF.HUD.update;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { if (window.SF && SF.CooldownPips) SF.CooldownPips.paint(); } catch (e) {}
      return r;
    };
    wrapped._pipsWrapped = true;
    SF.HUD.update = wrapped;
  }
})();

/* ================= combat-death-recap phase (2026-10-21) =================
 * SF.DeathRecap: MISSION DEBRIEF on player death — killer name/class,
 * damage breakdown by source (top 3 with icons), time survived,
 * credits/standing deltas this run, and one contextual tip keyed on the
 * top damage source. Pure presentation on existing combat/death events;
 * balance and save schema are untouched (no SAVE_VERSION bump).
 *
 * SF.KillFeed: last-5-kills ticker in the top-right HUD corner with
 * ship-class icons, fading entries.
 *
 * Integration is strictly additive + idempotent (the established hud.js
 * pattern, cf. SF.DamageFX / SF.Tutorial):
 *  - damage events: wraps SF.Player.takeDamage (js/ship.js is out of
 *    scope). The source is resolved at hit time by mirroring the
 *    DamageFX sourceAngle logic but keeping the enemy object, so hits
 *    group by ship class / AI pattern / faction / boss / elite.
 *  - death: wraps SF.Game.onPlayerDeath; after the stock gameover panel
 *    paints, a runtime-built MISSION DEBRIEF block is painted inside
 *    #overlay-gameover (index.html is out of scope — DOM is created at
 *    runtime).
 *  - kills: wraps SF.Enemies.kill; recorded only while
 *    SF.Game.state === 'PLAYING'.
 *  - run bookkeeping: wraps SF.Game.newGame + SF.Game.setState; a new
 *    run starts on newGame and on the GAMEOVER -> PLAYING transition
 *    (respawn() is closure-local in main.js and not exported).
 * All state is runtime-only. Every wrap carries a distinct guard flag
 * plus a 3s re-hook interval so load order vs. other phases is safe.
 */
window.SF = window.SF || {};

SF.DeathRecap = (function () {
  'use strict';

  var CONTACT_RANGE = 90;        // px: enemy this close to the player = rammer
  var ENEMY_RANGE2 = 500 * 500; // fallback: nearest enemy to the player
  var SHOOTER_RANGE2 = 800 * 800; // shooter search radius around a projectile

  /* ---------- source resolution ---------- */

  function enemyList() {
    try {
      var l = SF.Enemies.list;
      return (typeof l === 'function') ? l() : (l || []);
    } catch (e) { return []; }
  }

  /* The enemy most likely responsible for a hit, resolved at hit time.
   *  1. an enemy within contact range of the player (deterministic for
   *     rams — this is what the smoke test drives);
   *  2. the most recently deactivated enemy projectile within 80px
   *     (main.js sets pr.active=false just before takeDamage) -> the
   *     nearest living enemy to that projectile (the likely shooter);
   *  3. the nearest living enemy within 500px of the player.
   * null = environmental / unknown source. */
  function resolveSource() {
    var P = SF.Player;
    if (!P) return null;
    var i, dx, dy, d2, best, bd;
    try {
      var l = enemyList();
      for (i = 0; i < l.length; i++) {
        var e = l[i];
        if (!e || e.dead) continue;
        dx = e.x - P.x; dy = e.y - P.y;
        if (dx * dx + dy * dy < CONTACT_RANGE * CONTACT_RANGE) return e;
      }
    } catch (e) {}
    try {
      var pool = SF.Projectiles.pool, pr = null;
      bd = 80 * 80;
      for (i = 0; i < pool.length; i++) {
        var q = pool[i];
        if (!q || q.friendly || q.active) continue;
        dx = q.x - P.x; dy = q.y - P.y;
        d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; pr = q; }
      }
      if (pr) {
        best = null; bd = SHOOTER_RANGE2;
        var l2 = enemyList();
        for (i = 0; i < l2.length; i++) {
          var e2 = l2[i];
          if (!e2 || e2.dead) continue;
          dx = e2.x - pr.x; dy = e2.y - pr.y;
          d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = e2; }
        }
        if (best) return best;
      }
    } catch (e2) {}
    try {
      best = null; bd = ENEMY_RANGE2;
      var l3 = enemyList();
      for (i = 0; i < l3.length; i++) {
        var e3 = l3[i];
        if (!e3 || e3.dead) continue;
        dx = e3.x - P.x; dy = e3.y - P.y;
        d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = e3; }
      }
      return best;
    } catch (e3) {}
    return null;
  }

  /* ---------- source identity ---------- */

  function factionShort(fid) {
    try {
      if (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid]) {
        return SF.FACTION_BY_ID[fid].short || SF.FACTION_BY_ID[fid].name;
      }
    } catch (e) {}
    return fid;
  }

  function srcKey(e) {
    if (e.boss) return 'boss:' + ((e.bossDef && e.bossDef.id) || e.type || 'x');
    if (e.elite) return 'elite:' + (e.elite || 'x') + ':' + (e.type || 'x');
    if (e.faction) return 'faction:' + e.faction + ':' + (e.type || 'x');
    if (e.trader) return 'trader:' + (e.type || 'x');
    if (e.pattern) return e.pattern + ':' + (e.type || 'x');
    return 'type:' + (e.type || 'x');
  }

  function srcLabel(e) {
    var name = (e.spec && e.spec.scoreName) || e.type || 'Hostile';
    if (e.boss) return name + ' \u2620 BOSS';
    if (e.elite) return (e.eliteName || ('Elite ' + name)) + ' \uD83D\uDC80';
    if (e.faction) return factionShort(e.faction) + ' ' + name;
    if (e.trader) return 'Freighter ' + name;
    if (e.pattern === 'kamikaze') return 'Kamikaze ' + name;
    if (e.pattern === 'sniper') return name + ' Sniper';
    if (e.pattern === 'weaver') return 'Weaver ' + name;
    return name;
  }

  function srcIcon(e) {
    if (e.boss) return '\u2620';
    if (e.elite) return '\uD83D\uDC80';
    if (e.pattern === 'kamikaze') return '\uD83D\uDCA5';
    if (e.pattern === 'sniper') return '\uD83C\uDFAF';
    if (e.pattern === 'weaver') return '\u303D';
    if (e.trader) return '\u25A3';
    var icons = { drone: '\u25C8', raider: '\u25C6', gunship: '\u25B2' };
    return icons[e.type] || '\u2716';
  }

  /* ---------- run bookkeeping ---------- */

  var run = null; // {t0, credits0, standing0, totals:{}, totalDmg, order, killerKey}

  function standings() {
    var o = {};
    try {
      if (window.SF && SF.Factions && SF.FACTION_LIST) {
        SF.FACTION_LIST.forEach(function (f) { o[f.id] = SF.Factions.standing(f.id); });
      }
    } catch (e) {}
    return o;
  }

  function startRun() {
    run = {
      t0: Date.now(),
      credits0: 0,
      standing0: standings(),
      totals: {},
      totalDmg: 0,
      order: 0,
      killerKey: null
    };
    try { run.credits0 = Math.floor(SF.Player.credits); } catch (e) {}
  }

  function recordHit(dmg) {
    if (!run) startRun();
    var n = Math.round(+dmg);
    var src = resolveSource();
    var key = src ? srcKey(src) : 'unknown';
    if (!isFinite(n) || n <= 0) return key;
    var t = run.totals[key];
    if (!t) {
      t = run.totals[key] = {
        key: key,
        label: src ? srcLabel(src) : 'Unknown hazard',
        icon: src ? srcIcon(src) : '\u26A0',
        dmg: 0,
        first: run.order
      };
    }
    t.dmg += n;
    run.totalDmg += n;
    run.order++;
    return key;
  }

  function topSources(n) {
    var arr = [];
    if (!run) return arr;
    for (var k in run.totals) {
      if (run.totals.hasOwnProperty(k)) arr.push(run.totals[k]);
    }
    arr.sort(function (a, b) { return b.dmg - a.dmg; });
    return arr.slice(0, n || 3);
  }

  /* ---------- contextual tips ---------- */

  var TIPS = [
    [/sniper/, 'Snipers outrange you \u2014 close the distance or boost shields before the telegraph finishes.'],
    [/kamikaze/, 'Kamikazes telegraph their run \u2014 boost sideways the instant the warning triangle flashes.'],
    [/weaver/, 'Weavers slip sideways to dodge \u2014 lead your shots instead of chasing their tail.'],
    [/boss/, 'Bosses cycle attack phases \u2014 learn the rhythm and never facetank the enrage.'],
    [/elite/, 'Elites enrage at low hull \u2014 save your burst for after the roar.'],
    [/gunship/, 'Gunships fire homing bolts \u2014 weave hard and break their lock.'],
    [/raider/, 'Raiders strafe relentlessly \u2014 keep moving and fight them one at a time.'],
    [/drone/, 'Drones die to a single burst \u2014 don\u2019t let them swarm you.'],
    [/trader/, 'Even convoys bite back \u2014 or just buy the cargo instead of taking it.'],
    [/faction/, 'Faction patrols never back down \u2014 improve your standing or bring a bigger gun.']
  ];
  var TIP_DEFAULT = 'Hull down is no place to learn \u2014 dock, repair, and pick your next fight.';

  function tipFor(key) {
    for (var i = 0; i < TIPS.length; i++) {
      if (TIPS[i][0].test(key)) return TIPS[i][1];
    }
    return TIP_DEFAULT;
  }

  /* ---------- debrief panel ---------- */

  var panel = null;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fmtSign(n) {
    return (n < 0 ? '\u2212' : '+') + Math.abs(n).toLocaleString('en-US');
  }

  function ensurePanel() {
    if (panel) return;
    var css = document.createElement('style');
    css.id = 'debrief-css';
    css.textContent =
      '#debrief-panel{margin:10px 0 14px;padding:12px;border:1px solid #ff5e3a;' +
      'border-radius:10px;background:rgba(24,8,8,.55);text-align:left}' +
      '#debrief-panel h2{margin:0 0 8px;font-size:15px;letter-spacing:3px;' +
      'color:#ff8d7a;text-align:center}' +
      '.debrief-killer{text-align:center;font-size:16px;margin-bottom:10px;color:#fff}' +
      '.debrief-killer b{color:#ffd23f}' +
      '.debrief-row{display:flex;justify-content:space-between;gap:8px;' +
      'font-size:13px;color:#dfe9ff;padding:3px 2px;' +
      'border-bottom:1px solid rgba(255,255,255,.06)}' +
      '.debrief-row .dmg{color:#ff8d7a;font-weight:700;white-space:nowrap}' +
      '.debrief-meta{display:flex;justify-content:space-between;font-size:12px;' +
      'color:#9fb3d9;margin-top:8px;flex-wrap:wrap;gap:4px}' +
      '.debrief-meta b{color:#fff}' +
      '.debrief-tip{margin-top:10px;padding:8px 10px;' +
      'background:rgba(57,213,232,.08);border-left:3px solid #39d5e8;' +
      'font-size:13px;color:#cfe8ff;line-height:1.4}';
    document.head.appendChild(css);
    var host = document.querySelector('#overlay-gameover .panel');
    if (!host) return;
    panel = document.createElement('div');
    panel.id = 'debrief-panel';
    host.appendChild(panel);
  }

  function paintDebrief() {
    ensurePanel();
    if (!panel || !run) return;
    var top = topSources(3);
    var killer = (run.killerKey && run.totals[run.killerKey]) ?
      run.totals[run.killerKey] : (top[0] || null);

    var creditsNow = 0;
    try { creditsNow = Math.floor(SF.Player.credits); } catch (e) {}
    var earned = creditsNow - run.credits0;
    var fee = 0;
    try { fee = Math.floor(creditsNow * SF.CONFIG.economy.respawnLoss); } catch (e2) {}

    var standChips = [];
    try {
      if (window.SF && SF.Factions && SF.FACTION_LIST) {
        SF.FACTION_LIST.forEach(function (f) {
          var d = SF.Factions.standing(f.id) - (run.standing0[f.id] || 0);
          if (d !== 0) {
            standChips.push('<span style="color:' + f.color + '">' + esc(f.short) +
              ' ' + (d > 0 ? '+' : '') + d + '</span>');
          }
        });
      }
    } catch (e3) {}

    var rows = top.map(function (t) {
      var pct = run.totalDmg > 0 ? Math.round(t.dmg / run.totalDmg * 100) : 0;
      return '<div class="debrief-row"><span>' + esc(t.icon) + ' ' + esc(t.label) +
        '</span><span class="dmg">' + t.dmg.toLocaleString('en-US') + ' dmg \u00B7 ' +
        pct + '%</span></div>';
    }).join('');

    /* Tip is keyed on the KILLER (the brief's example: killed by snipers =>
     * sniper tip); falls back to the top damage source when the killing
     * blow's source was unknown. */
    var tipKey = (killer && killer.key) || (top[0] && top[0].key) || 'unknown';

    panel.innerHTML =
      '<h2>\u25C8 MISSION DEBRIEF \u25C8</h2>' +
      (killer
        ? '<div class="debrief-killer">KILLED BY <b>' + esc(killer.icon) + ' ' +
          esc(killer.label) + '</b></div>'
        : '<div class="debrief-killer">KILLED BY <b>\u26A0 Unknown hazard</b></div>') +
      (rows ? '<div>' + rows + '</div>' : '') +
      '<div class="debrief-meta">' +
      '<span>\u23F1 SURVIVED <b>' + fmtTime(Date.now() - run.t0) + '</b></span>' +
      '<span>\uD83D\uDCB0 <b>' + fmtSign(earned) + '</b> earned \u00B7 <b>\u2212' +
      fee.toLocaleString('en-US') + '</b> respawn fee</span>' +
      (standChips.length ? '<span>' + standChips.join(' \u00B7 ') + '</span>' : '') +
      '</div>' +
      '<div class="debrief-tip">\uD83D\uDCA1 ' + esc(tipFor(tipKey)) + '</div>';
  }

  /* ---------- hooks (all idempotent, re-hooked on an interval) ---------- */

  var recordingTD = false; // re-entrancy guard, see hookTakeDamage

  function hookTakeDamage() {
    if (!window.SF || !SF.Player || typeof SF.Player.takeDamage !== 'function') return;
    var orig = SF.Player.takeDamage;
    if (orig._deathRecapWrapped) return;
    /* re-entrancy guard: if another of our own recorders is already in the
     * chain for this hit (e.g. a duplicate install over a wrapper that did
     * not propagate our `_` flag), the inner one delegates without
     * recording. The flag is held across orig.call so nesting is covered. */
    var w = function (dmg) {
      if (recordingTD) return orig.call(this, dmg);
      recordingTD = true;
      var wasAlive = false, key = 'unknown', r;
      try {
        wasAlive = !!(SF.Player && SF.Player.alive);
        key = recordHit(dmg); // resolves the source BEFORE damage applies
      } catch (e) {}
      try { r = orig.call(this, dmg); }
      finally { recordingTD = false; }
      try {
        if (wasAlive && run && SF.Player && !SF.Player.alive && !run.killerKey) {
          run.killerKey = key;
        }
      } catch (e2) {}
      return r;
    };
    w._deathRecapWrapped = true;
    SF.Player.takeDamage = w;
  }

  function hookDeath() {
    if (!window.SF || !SF.Game || typeof SF.Game.onPlayerDeath !== 'function') return;
    var orig = SF.Game.onPlayerDeath;
    if (orig._deathRecapWrapped) return;
    var w = function () {
      var r = orig.call(this);
      /* Deferred: onPlayerDeath fires synchronously from inside
       * SF.Player.takeDamage, but run.killerKey is only recorded after the
       * takeDamage wrapper returns. Paint on the next tick so the killer
       * line shows the killing blow's source, not the top-damage fallback. */
      try { setTimeout(paintDebrief, 0); } catch (e) {}
      return r;
    };
    w._deathRecapWrapped = true;
    SF.Game.onPlayerDeath = w;
  }

  function hookNewGame() {
    if (!window.SF || !SF.Game || typeof SF.Game.newGame !== 'function') return;
    var orig = SF.Game.newGame;
    if (orig._deathRecapWrapped) return;
    var w = function () {
      var r = orig.call(this);
      try { startRun(); } catch (e) {}
      return r;
    };
    w._deathRecapWrapped = true;
    SF.Game.newGame = w;
  }

  function hookSetState() {
    if (!window.SF || !SF.Game || typeof SF.Game.setState !== 'function') return;
    var orig = SF.Game.setState;
    if (orig._deathRecapWrapped) return;
    var w = function (s) {
      var prev = null;
      try { prev = SF.Game.state; } catch (e) {}
      var r = orig.call(this, s);
      try {
        // respawn() is closure-local in main.js: the GAMEOVER -> PLAYING
        // transition is its observable signature.
        if (prev === 'GAMEOVER' && s === 'PLAYING') startRun();
      } catch (e2) {}
      return r;
    };
    w._deathRecapWrapped = true;
    SF.Game.setState = w;
  }

  function hookAll() {
    if (!window.SF) return;
    hookTakeDamage();
    bindButtons();
    if (SF.Game) { hookDeath(); hookNewGame(); hookSetState(); }
  }

  /* main.js's title-screen buttons call closure-local newGame()/respawn()/
   * continueGame(), not the SF.Game exports — so the wraps above never see
   * them. Bind the buttons directly (same indirection the Tutorial phase
   * uses for #btn-new); the deferred startRun lets the game's own handler
   * (which resets the player) run first. */
  function bindButtons() {
    if (typeof document === 'undefined') return;
    var defs = [
      ['btn-new', 'new game'],
      ['btn-respawn', 'respawn'],
      ['btn-continue', 'continue']
    ];
    for (var i = 0; i < defs.length; i++) {
      (function (id) {
        try {
          var b = document.getElementById(id);
          if (b && !b._deathRecapBound) {
            b._deathRecapBound = true;
            b.addEventListener('click', function () { setTimeout(startRun, 500); });
          }
        } catch (e) {}
      })(defs[i][0]);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookAll);
    } else { hookAll(); }
  }
  if (typeof setInterval !== 'undefined') setInterval(hookAll, 3000);

  return {
    srcKey: srcKey,
    srcLabel: srcLabel,
    srcIcon: srcIcon,
    tipFor: tipFor,
    _startRun: startRun,
    _paintDebrief: paintDebrief,
    _state: function () {
      if (!run) return { runActive: false };
      var t = {};
      for (var k in run.totals) {
        if (run.totals.hasOwnProperty(k)) {
          t[run.totals[k].label] = run.totals[k].dmg;
        }
      }
      return {
        runActive: true,
        killerKey: run.killerKey,
        totals: t,
        totalDmg: run.totalDmg,
        timeMs: Date.now() - run.t0
      };
    }
  };
})();

/* ================= SF.KillFeed (combat-death-recap phase) =================
 * Last-5-kills ticker, top-right HUD corner, ship-class icons, fading
 * entries. Records only while SF.Game.state === 'PLAYING'. Wraps
 * SF.Enemies.kill additively (idempotent guard + 3s re-hook).
 */
SF.KillFeed = (function () {
  'use strict';

  var FEED_N = 5;
  var FADE_MS = 4200;
  var PRUNE_MS = 6800;

  var entries = []; // newest first: {icon,label,boss,elite,t}
  var el = null;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureDom() {
    if (el) return;
    var css = document.createElement('style');
    css.id = 'killfeed-css';
    css.textContent =
      '#killfeed{position:fixed;top:64px;right:10px;z-index:8500;' +
      'pointer-events:none;display:flex;flex-direction:column;gap:4px;' +
      'align-items:flex-end}' +
      '.kf-entry{background:rgba(6,12,26,.82);border:1px solid #39d5e8;' +
      'border-radius:6px;padding:4px 10px;color:#dfe9ff;' +
      'font:bold 12px monospace;letter-spacing:1px;' +
      'animation:kf-in .18s ease-out;transition:opacity .6s}' +
      '.kf-entry.kf-boss{border-color:#ff5e3a;color:#ffcf9d}' +
      '.kf-entry.kf-elite{border-color:#b45cff;color:#e3c8ff}' +
      '@keyframes kf-in{from{transform:translateX(24px);opacity:0}' +
      'to{transform:none;opacity:1}}';
    document.head.appendChild(css);
    el = document.createElement('div');
    el.id = 'killfeed';
    document.body.appendChild(el);
    if (typeof setInterval !== 'undefined') setInterval(fadeTick, 500);
  }

  function render() {
    if (!el) return;
    var now = Date.now(), html = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var cls = 'kf-entry' + (e.boss ? ' kf-boss' : '') + (e.elite ? ' kf-elite' : '');
      html += '<div class="' + cls + '" style="opacity:' +
        (now - e.t > FADE_MS ? '0.25' : '1') + '">' +
        esc(e.icon) + ' ' + esc(e.label) + '</div>';
    }
    el.innerHTML = html;
  }

  function fadeTick() {
    if (!el || !entries.length) return;
    var now = Date.now(), pruned = false, i;
    for (i = entries.length - 1; i >= 0; i--) {
      if (now - entries[i].t > PRUNE_MS) { entries.splice(i, 1); pruned = true; }
    }
    if (pruned) { render(); return; }
    // soft-fade entries past FADE_MS without rebuilding the DOM
    var kids = el.children;
    for (i = 0; i < entries.length && i < kids.length; i++) {
      if (now - entries[i].t > FADE_MS) kids[i].style.opacity = '0.25';
    }
  }

  function add(entry) {
    ensureDom();
    entries.unshift(entry);
    if (entries.length > FEED_N) entries.length = FEED_N;
    render();
  }

  var recordingKill = false; // re-entrancy guard: a duplicate of our own
  // recorder in the chain (see DeathRecap's recordingTD) delegates without
  // recording; the flag is held across orig.call so nesting is covered.

  function hookKill() {
    if (!window.SF || !SF.Enemies || typeof SF.Enemies.kill !== 'function') return;
    var orig = SF.Enemies.kill;
    if (orig._killFeedWrapped) return;
    var w = function (e) {
      if (recordingKill) return orig.call(this, e);
      recordingKill = true;
      var r;
      try {
        if (e && window.SF && SF.Game && SF.Game.state === 'PLAYING' &&
            window.SF.DeathRecap) {
          add({
            icon: SF.DeathRecap.srcIcon(e),
            label: SF.DeathRecap.srcLabel(e),
            boss: !!e.boss,
            elite: !!e.elite,
            t: Date.now()
          });
        }
      } catch (err) {}
      try { r = orig.call(this, e); }
      finally { recordingKill = false; }
      return r;
    };
    w._killFeedWrapped = true;
    SF.Enemies.kill = w;
  }

  function hookAll() {
    if (window.SF) hookKill();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookAll);
    } else { hookAll(); }
  }
  if (typeof setInterval !== 'undefined') setInterval(hookAll, 3000);

  return {
    entries: function () {
      return entries.map(function (e) {
        return { icon: e.icon, label: e.label, boss: e.boss, elite: e.elite };
      });
    },
    count: function () { return entries.length; },
    clear: function () { entries.length = 0; render(); }
  };
})();
/* ================= end combat-death-recap phase ================= */

/* ================= hud-declutter-1 phase (2026-10-22) =================
 * SF.HudDeclutter: slot discipline for the center HUD stack, from the
 * user's 2026-10-22 S25 screenshots (boss bar over the raid banner and
 * over the SHIP LOST modal, subsystem bars under the cooldown pips,
 * stance tabs colliding with the stats chips, clipped FIRE button).
 *
 * Fixed slots (CSS px from top, safe-area aside):
 *   0-~56   #hud-top (hull/shield bars | system + credits/ore/cargo | minimap)
 *   56-~82  reactor stance tabs + heat bar (canvas, js/ship.js — owner);
 *           TOP-RIGHT since 2026-10-23 (user: shrink + move), right-aligned
 *           ending 8px left of the minimap wrap — center slot is free now
 *   88-~134 SF.RaidBar (runtime DOM, js/station.js — owner, z-9000 there)
 *   106-~156 wingman formation widget (canvas, js/ship.js — owner)
 *   178     #hud-tracker (css/style.css)
 *   216     #boss-bar (SF.BossBar above: z-21, width min(420px,60vw), 8px track)
 *
 * This module owns the state-transition half of the boss-bar fix:
 * SF.HUD.update (which paints the bar) only runs while PLAYING, so a
 * bar left visible at death stayed painted over the game-over modal.
 * The wraps below hide it the moment the game leaves PLAYING, whichever
 * door it leaves by (setState or showHud(false)). Wraps follow this
 * file's established convention (guard flags, deferred install —
 * js/main.js loads AFTER hud.js, so SF.Game may not exist at parse).
 *
 * Also in this phase (elsewhere in this file / css / index.html):
 *  - minimap default flipped to hidden (SF.MenuDrawer.isMinimapHidden)
 *  - standing/karma/XP moved to the MENU drawer stats strip
 *  - SF.CooldownPips row reserves the ship.js subsystem-cluster zone
 *  - FIRE/PING touch buttons: safe-area offsets + guaranteed gap (css)
 * Save-neutral: runtime/CSS/DOM only, no SAVE_VERSION bump.
 */
SF.HudDeclutter = (function () {
  'use strict';

  var SLOTS = { hudTop: 0, reactorTabs: 64, raidBar: 88, tracker: 178, bossBar: 216 };

  function hideBossBar() {
    try { if (window.SF && SF.BossBar) SF.BossBar.hide(); } catch (e) {}
  }

  var gameWrapped = false, hudWrapped = false;

  function install() {
    if (window.SF && SF.Game && typeof SF.Game.setState === 'function' &&
        !SF.Game.setState._declutterWrapped && !gameWrapped) {
      var origState = SF.Game.setState;
      var wState = function (s) {
        var r = origState.apply(this, arguments);
        if (s !== 'PLAYING') hideBossBar();
        return r;
      };
      wState._declutterWrapped = true;
      SF.Game.setState = wState;
      gameWrapped = true;
    }
    if (window.SF && SF.HUD && typeof SF.HUD.showHud === 'function' &&
        !SF.HUD.showHud._declutterWrapped && !hudWrapped) {
      var origHud = SF.HUD.showHud;
      var wHud = function (v) {
        if (!v) hideBossBar();
        return origHud.apply(this, arguments);
      };
      wHud._declutterWrapped = true;
      SF.HUD.showHud = wHud;
      hudWrapped = true;
    }
    return gameWrapped && hudWrapped;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { install(); });
    } else { install(); }
  }
  if (typeof setInterval !== 'undefined') {
    var tries = 0;
    var iv = setInterval(function () {
      if (install() || ++tries > 40) clearInterval(iv);
    }, 500);
  }

  return {
    slots: SLOTS,
    install: install,
    hideBossBar: hideBossBar,
    wrapped: function () { return { game: gameWrapped, hud: hudWrapped }; }
  };
})();
/* ================= end hud-declutter-1 phase ================= */

/* ================= combat-context-hud phase (2026-10-22) =================
 * SF.CombatHUD: two-mode HUD (user design direction, 2026-10-22 — his
 * words: "combat relative bars should only appear after firing your
 * weapon or taking damage"; reference feel = STARFALL's decluttered HUD
 * mixed with Event Horizon's readable combat and Space RPG 4's
 * near-empty exploration screen / EXPLORE-COMBAT split. Principles only;
 * no assets, art, layouts or text copied from either game.)
 *
 * MODES (body classes are the single source of truth for CSS):
 *   body.hud-explore (default) — slim top strip, flight controls,
 *     contextual prompts. Combat-relative elements hidden or at rest:
 *     boss bar, raid bar (both opacity-gated; their owners still own
 *     display), kill feed history, threat-legend chip; cooldown pips
 *     not painted while idle; hull/shield DIMMED (opacity .45) while
 *     the ship is at 100% hull AND shield (body.cb-undamaged).
 *   body.hud-combat — everything combat-relative fades in at the
 *     EXISTING declutter slots (raid 88 / tracker 178 / boss 216 —
 *     SF.HudDeclutter.slots is law; no new positions invented).
 *
 * TRIGGERS (enter + refresh the idle clock): player fires (wrap on
 * SF.Audio.weaponSound — the same hook SF.CooldownPips documents as
 * called ONLY from the player fire block in ship.js), player takes
 * damage (wrap on SF.Player.takeDamage, chaining with DamageFX /
 * DeathRecap wraps via a distinct guard flag), a hostile is aggro'd on
 * the player within engagement range, an enemy projectile is in flight,
 * a boss engagement is live, or a raid is warn/active in this system.
 * EXIT: 7s with no combat event (IDLE_S) — DOM elements fade ~500ms
 * via the css transitions in style.css; canvas overlays (pips) fade
 * via element opacity. Leaving PLAYING (any setState / showHud(false))
 * forces exploration so GAMEOVER / title / docked show nothing.
 *
 * MECHANISM (honest note): fire/damage use additive wraps; aggro /
 * boss / raid / hostile-fire are POLLED once per SF.HUD.update from a
 * wrap on SF.HUD.update (chaining the CooldownPips wrap), because the
 * aggro state lives in js/enemies.js and raid state in js/station.js —
 * both outside this phase's scope to edit. Poll cost is one pass over
 * SF.Enemies.list + SF.Projectiles.pool per frame, all reads guarded.
 *
 * ELEMENT GATING:
 *   #boss-bar   — SF.BossBar.update still runs; tick() hides it after
 *                 the fact in the same frame while exploring and not
 *                 engaged; css opacity gate is the second layer.
 *   #raid-bar   — never wrapped: a warn/active raid in this system IS
 *                 an engagement, so the poll enters combat and the bar
 *                 is legitimate whenever its owner shows it.
 *   #killfeed   — css opacity gate only (entries live ~6.8s and kills
 *                 only happen in combat, so fresh kills always flash
 *                 in combat mode; history is invisible at rest).
 *   pips canvas — paint() wrapped: painted only in combat or while a
 *                 pip is actively cooling / heat is up; at rest the
 *                 canvas is faded out (opacity), not redrawn.
 *   threat rings / legend — SF.ThreatRings.paint / SF.ThreatLegend
 *                 .paint wrapped: skipped while exploring (the minimap
 *                 itself, when the player unhides it, still draws).
 *   hull/shield — always present (survival info); dim rule above.
 *   announcements — SF.HUD.toast, SF.CombatFeed, SF.DamageFX are NOT
 *                 gated: they are transient, not persistent bars.
 *   stance tabs — the reactor stance widget (BAL/AST/AEG/OVR + heat) is
 *                 canvas-drawn inside js/ship.js (closure-private, the
 *                 same reason SF.PhotoMode masks it post-render). It
 *                 CANNOT be gated from hud.js/css without a fragile
 *                 per-frame mask, so it is the one documented follow-up:
 *                 ship.js should skip the widget draw while
 *                 SF.CombatHUD.inCombat() is false (heat/vent excepted).
 *   subsystem bars — canvas in js/ship.js; hud-declutter-2 already made
 *                 them healthy-hidden / damaged-only. No DOM mirror
 *                 exists, so there is nothing further to gate here.
 *
 * Save-neutral: runtime only, SAVE_VERSION untouched (v11).
 * Test hooks: debug(), _forceIdle() (backdate the clock + tick),
 * _setModeForTest via enter/exit.
 */
SF.CombatHUD = (function () {
  'use strict';

  var IDLE_S = 7;          // seconds without a combat event -> exploration
  var AGGRO_DIST = 1500;   // aggro'd enemy refreshes combat within this range
  var BOSS_DIST = 1100;    // a live boss this close counts as engaged even
                           // before first blood (spawnFor drops them ~500u out)

  var mode = 'explore';    // 'explore' | 'combat'
  var lastEventAt = -Infinity;
  var lastReason = '';

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }
  function playing() {
    try { return !!(window.SF && SF.Game && SF.Game.state === 'PLAYING'); }
    catch (e) { return false; }
  }

  /* ---------------- mode core ---------------- */

  function applyClasses() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('hud-combat', mode === 'combat');
    document.body.classList.toggle('hud-explore', mode !== 'combat');
  }

  function enter(reason) {
    lastEventAt = nowS();
    if (reason) lastReason = reason;
    if (mode !== 'combat') { mode = 'combat'; applyClasses(); }
  }

  function exit() {
    mode = 'explore';
    lastReason = '';
    applyClasses();
    syncBarsDim();
  }

  function forceExplore() {
    lastEventAt = -Infinity;
    exit();
  }

  /* hull/shield dim rule: dimmed only while BOTH are at 100% */
  function syncBarsDim() {
    if (typeof document === 'undefined' || !document.body) return;
    var full = false;
    try {
      var p = SF.Player;
      if (p && typeof p.maxHull === 'function' && typeof p.maxShield === 'function') {
        var hf = p.maxHull() > 0 ? p.hull / p.maxHull() : 1;
        var sf = p.maxShield() > 0 ? p.shield / p.maxShield() : 1;
        full = hf >= 0.999 && sf >= 0.999;
      }
    } catch (e) {}
    document.body.classList.toggle('cb-undamaged', full);
  }

  /* ---------------- engagement polls (reads only) ---------------- */

  function bossEngaged() {
    try {
      var l = SF.Enemies.list, p = SF.Player;
      for (var i = 0; i < l.length; i++) {
        var e = l[i];
        if (!e || e.dead || !e.boss) continue;
        if (e.playerAggro || (e.bossPhase || 0) >= 1) return true;
        if (p && Math.hypot(e.x - p.x, e.y - p.y) < BOSS_DIST) return true;
      }
    } catch (e) {}
    return false;
  }

  function raidEngaged() {
    try {
      if (!window.SF || !SF.Raids || !SF.Game) return false;
      var rs = SF.Raids.status();
      return !!(rs && rs.sys === SF.Game.systemId &&
        (rs.state === 'warn' || rs.state === 'active'));
    } catch (e) { return false; }
  }

  function aggroNear() {
    try {
      var l = SF.Enemies.list, p = SF.Player;
      if (!p) return false;
      for (var i = 0; i < l.length; i++) {
        var e = l[i];
        if (!e || e.dead || !e.playerAggro) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < AGGRO_DIST) return true;
      }
    } catch (e) {}
    return false;
  }

  function hostileFire() {
    try {
      var pool = SF.Projectiles.pool;
      for (var i = 0; i < pool.length; i++) {
        var pr = pool[i];
        if (pr && pr.active && !pr.friendly) return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------------- boss-bar gate (post-update, same frame) --------- */

  function gateBossBar() {
    try {
      if (mode === 'combat') return;
      if (window.SF && SF.BossBar && SF.BossBar.isVisible()) SF.BossBar.hide();
    } catch (e) {}
  }

  /* ---------------- per-frame tick (driven from SF.HUD.update) ------ */

  function tick() {
    if (!playing()) { if (mode !== 'explore') forceExplore(); applyClasses(); return; }
    if (bossEngaged()) enter('boss');
    else if (raidEngaged()) enter('raid');
    else if (aggroNear()) enter('aggro');
    else if (hostileFire()) enter('hostile-fire');
    if (mode === 'combat' && nowS() - lastEventAt > IDLE_S) exit();
    applyClasses();
    syncBarsDim();
    gateBossBar();
  }

  /* ---------------- wraps (additive, distinct guard flags) ---------- */

  function wrapFire() {
    if (!window.SF || !SF.Audio || typeof SF.Audio.weaponSound !== 'function') return;
    var orig = SF.Audio.weaponSound;
    if (orig._combatHudWrapped) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { if (playing()) enter('fire'); } catch (e) {}
      return r;
    };
    w._combatHudWrapped = true;
    SF.Audio.weaponSound = w;
  }

  function wrapDamage() {
    if (!window.SF || !SF.Player || typeof SF.Player.takeDamage !== 'function') return;
    var orig = SF.Player.takeDamage;
    if (orig._combatHudWrapped) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { if (playing()) enter('damage'); } catch (e) {}
      return r;
    };
    w._combatHudWrapped = true;
    SF.Player.takeDamage = w;
  }

  function wrapState() {
    if (!window.SF || !SF.Game || typeof SF.Game.setState !== 'function') return;
    var orig = SF.Game.setState;
    if (orig._combatHudWrapped) return;
    var w = function (s) {
      var r = orig.apply(this, arguments);
      try { if (s !== 'PLAYING') forceExplore(); } catch (e) {}
      return r;
    };
    w._combatHudWrapped = true;
    SF.Game.setState = w;
  }

  function wrapShowHud() {
    if (!window.SF || !SF.HUD || typeof SF.HUD.showHud !== 'function') return;
    var orig = SF.HUD.showHud;
    if (orig._combatHudWrapped) return;
    var w = function (v) {
      var r = orig.apply(this, arguments);
      try { if (!v) forceExplore(); } catch (e) {}
      return r;
    };
    w._combatHudWrapped = true;
    SF.HUD.showHud = w;
  }

  function wrapHudUpdate() {
    if (!window.SF || !SF.HUD || typeof SF.HUD.update !== 'function') return;
    var orig = SF.HUD.update;
    if (orig._combatHudTickWrapped) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { tick(); } catch (e) {}
      return r;
    };
    w._combatHudTickWrapped = true;
    SF.HUD.update = w;
  }

  /* cooldown pips: paint only in combat, or while something is actually
   * cooling / heat is up; at rest fade the canvas out via opacity and
   * leave the last frame untouched underneath (invisible). Delegates to
   * the original paint whenever the game is not PLAYING (it self-clears). */
  function wrapPips() {
    if (!window.SF || !SF.CooldownPips || typeof SF.CooldownPips.paint !== 'function') return;
    var orig = SF.CooldownPips.paint;
    if (orig._combatHudWrapped) return;
    var w = function () {
      try {
        if (!playing()) return orig.apply(this, arguments);
        var snap = (typeof SF.CooldownPips.snapshot === 'function')
          ? SF.CooldownPips.snapshot() : null;
        var active = mode === 'combat';
        if (!active && snap) {
          if (snap.heat && snap.heat.visible) active = true;
          var ps = snap.pips || [];
          for (var i = 0; i < ps.length; i++) if (ps[i].frac < 1) { active = true; break; }
        }
        var cv = document.getElementById('cooldown-pips-overlay');
        if (active) {
          if (cv) cv.style.opacity = '1';
          return orig.apply(this, arguments);
        }
        if (cv) cv.style.opacity = '0';
        return undefined;
      } catch (e) { return orig.apply(this, arguments); }
    };
    w._combatHudWrapped = true;
    SF.CooldownPips.paint = w;
  }

  /* threat rings + legend draw onto the minimap canvas: combat-relative,
   * so skip them at rest. The minimap's own blips are not gated. */
  function wrapThreatPaint(objName) {
    var obj = window.SF && SF[objName];
    if (!obj || typeof obj.paint !== 'function') return;
    var orig = obj.paint;
    if (orig._combatHudWrapped) return;
    var w = function () {
      if (mode !== 'combat') return undefined;
      return orig.apply(this, arguments);
    };
    w._combatHudWrapped = true;
    obj.paint = w;
  }

  function install() {
    if (typeof window === 'undefined' || !window.SF) return;
    wrapFire(); wrapDamage(); wrapState(); wrapShowHud();
    wrapHudUpdate(); wrapPips();
    wrapThreatPaint('ThreatRings'); wrapThreatPaint('ThreatLegend');
    applyClasses(); syncBarsDim();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else { install(); }
  }
  /* deferred + periodic re-hook (load order / later re-wraps), the
   * established pattern in this file; every wrap checks its own flag. */
  if (typeof setInterval !== 'undefined') setInterval(install, 3000);

  return {
    IDLE_S: IDLE_S,
    AGGRO_DIST: AGGRO_DIST,
    BOSS_DIST: BOSS_DIST,
    enter: enter,
    exit: exit,
    inCombat: function () { return mode === 'combat'; },
    mode: function () { return mode; },
    lastEventAt: function () { return lastEventAt; },
    lastReason: function () { return lastReason; },
    tick: tick,
    debug: function () {
      return {
        mode: mode, lastReason: lastReason,
        agoS: lastEventAt === -Infinity ? null :
          Math.round((nowS() - lastEventAt) * 10) / 10,
        bodyCombat: typeof document !== 'undefined' && !!document.body &&
          document.body.classList.contains('hud-combat'),
        bodyExplore: typeof document !== 'undefined' && !!document.body &&
          document.body.classList.contains('hud-explore'),
        undamaged: typeof document !== 'undefined' && !!document.body &&
          document.body.classList.contains('cb-undamaged')
      };
    },
    /* test hook: backdate the idle clock and re-evaluate immediately */
    _forceIdle: function () { lastEventAt = nowS() - IDLE_S - 1; tick(); }
  };
})();
/* ================= end combat-context-hud phase ================= */

/* ================= beta-aim: off-nose threat hint =================
 * SF.AimHint: a contextual, pointer-transparent chip that appears ONLY in
 * the exact failing moment the beta probe measured — the player is firing
 * forward (FIRE button / Space, aim stick idle) while a hostile sits close
 * but far off the nose (the trailing-chaser blind spot: probe policy A
 * spent 99% of 20s with the drone outside the forward arc while firing
 * 75 shots for 1 hit). It names the fix the tutorial only mentions in
 * passing: drag the right side to aim 360 degrees. It never appears while
 * the player is already drag-aiming, never appears out of PLAYING, and
 * never blocks input (pointer-events: none, below the tutorial overlay).
 * Display-only: no damage, rate, AI, or control change. Same additive
 * SF.HUD.update wrap convention as SF.TargetLock / cooldown pips above.
 * Test API: SF.AimHint.visible(), SF.AimHint.state().
 */
SF.AimHint = (function () {
  var HINT_RANGE = 400;   // px: only threats close enough to be the complaint
  var OFF_NOSE = 1.0;     // rad (~57 deg): clearly outside the forward arc
  var chip = null, shown = false, lastDist = null, lastOffDeg = null;

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function ensure() {
    if (chip) return true;
    try {
      if (typeof document === 'undefined') return false;
      if (!document.getElementById('aim-hint-css')) {
        var css = document.createElement('style');
        css.id = 'aim-hint-css';
        css.textContent =
          '#aim-hint{position:fixed;left:50%;top:58px;transform:translateX(-50%);' +
          'z-index:9000;pointer-events:none;max-width:92vw;text-align:center;' +
          'padding:8px 12px;border-radius:10px;border:1px solid #ff9d5e;' +
          'background:rgba(20,10,4,.92);color:#ffd9a8;font-size:13px;' +
          'font-weight:700;letter-spacing:.3px;box-shadow:0 0 18px rgba(255,157,94,.35)}';
        document.head.appendChild(css);
      }
      chip = document.createElement('div');
      chip.id = 'aim-hint';
      chip.className = 'hidden';
      chip.textContent = 'DRAG THE RIGHT SIDE TO AIM IN ANY DIRECTION';
      document.body.appendChild(chip);
      return true;
    } catch (e) { return false; }
  }

  function threat() {
    try {
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return null;
      if (!SF.Player || !SF.Player.alive) return null;
      if (!SF.Input || SF.Input.aimActive) return null; // already drag-aiming
      if (!SF.Input.firing) return null; // only while the player is shooting
      var fireDir = SF.Player.angle; // stick idle => forward fire == nose
      var list = (SF.Enemies && SF.Enemies.list) || [];
      if (typeof list === 'function') list = list();
      var best = null, bd = HINT_RANGE + 1, boff = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || e.dead || e.trader || e.adrift) continue;
        if (e.faction && !e.playerAggro) {
          try {
            if (SF.Factions && typeof SF.Factions.stance === 'function' &&
                SF.Factions.stance(e.faction) !== 'hostile') continue;
          } catch (e2) { /* stance unreadable: treat as hostile */ }
        }
        var dx = e.x - SF.Player.x, dy = e.y - SF.Player.y;
        var d = Math.hypot(dx, dy);
        if (d > HINT_RANGE || d >= bd) continue;
        var off = Math.abs(angDiff(Math.atan2(dy, dx), fireDir));
        if (off <= OFF_NOSE) continue;
        best = e; bd = d; boff = off;
      }
      return best ? { e: best, dist: bd, offDeg: boff * 180 / Math.PI } : null;
    } catch (e3) { return null; }
  }

  function update() {
    if (!ensure()) return;
    var t = threat();
    lastDist = t ? Math.round(t.dist) : null;
    lastOffDeg = t ? Math.round(t.offDeg) : null;
    var want = !!t;
    if (want !== shown) {
      shown = want;
      chip.classList.toggle('hidden', !want);
    }
  }

  function wrap() {
    if (!window.SF || !SF.HUD || typeof SF.HUD.update !== 'function') return false;
    if (SF.HUD.update._aimHintWrapped) return true;
    var orig = SF.HUD.update;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { update(); } catch (e) {}
      return r;
    };
    w._aimHintWrapped = true;
    SF.HUD.update = w;
    return true;
  }
  if (!wrap() && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (wrap()) clearInterval(iv); }, 500);
  }

  return {
    update: update,
    visible: function () { return shown; },
    state: function () {
      return { shown: shown, dist: lastDist, offDeg: lastOffDeg,
               el: !!chip && !chip.classList.contains('hidden') };
    }
  };
})();

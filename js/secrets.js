/* ============================================================
 * STARFALL — Phase 5: Secrets
 *
 * SF.Secrets: 4 derelict ships with captain's logs + E-key
 * investigate, plus 1 anomaly in Drift (touch / leave choice:
 * 50% cache, 30% hull damage + raider ambush, 20% +10 karma).
 * Investigated derelicts never respawn; loot persists on the
 * save via SF.Player.secrets { investigated, anomalyDone, found }.
 * secretsFound counter counts every discovery.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  SF.DERELICTS = [
    { id: 'meridian_dawn', name: 'Meridian Dawn', systemId: 'solace', x: 800, y: 3400,
      log: 'CAPTAIN\'S LOG — MERIDIAN DAWN, day 214. The ore runs were good to us. ' +
           'The Compact taxed every crate and smiled while they did it. We took one ' +
           'last haul into the dark and never came back up. If you\'re reading this, ' +
           'the manifest is yours. Fly honest — or don\'t. The void doesn\'t care.',
      loot: { credits: 900, ore: 25, parts: ['ion_thruster'], items: ['fluxcap'] } },
    { id: 'wandering_tithe', name: 'Wandering Tithe', systemId: 'drift', x: 3300, y: 900,
      log: 'CAPTAIN\'S LOG — WANDERING TITHE. They called it a tithe. The Drifters ' +
           'took a tenth of everything and called it friendship. We paid. We kept ' +
           'flying. Then the Ember Pact took the other nine tenths and called it ' +
           'nothing at all. What\'s left in the hold is yours, scavenger.',
      loot: { credits: 1400, ore: 40, parts: ['fusion_core'], items: ['plasmacoil'] } },
    { id: 'ashen_vow', name: 'Ashen Vow', systemId: 'ember', x: 900, y: 900,
      log: 'CAPTAIN\'S LOG — ASHEN VOW. We swore to burn the Compact\'s lanes and ' +
           'salt the ground behind us. We burned. The ground was us. The reactor ' +
           'sang its last verse and the crew sang with it. Take the plating. It\'s ' +
           'still warm, and the cold out here doesn\'t forgive.',
      loot: { credits: 2200, ore: 60, parts: ['aegis_generator'], items: ['gravcore'] } },
    { id: 'goldrush', name: 'Goldrush', systemId: 'drift', x: 1200, y: 600,
      log: 'CAPTAIN\'S LOG — GOLDRUSH. Found it. Actually found it — the motherlode ' +
           'the whole rim was whispering about. Filled the hold, filled the decks, ' +
           'filled our lungs with something that glowed. Whatever you do, don\'t ' +
           'breathe the pretty dust. The credits are clean. The dust isn\'t.',
      loot: { credits: 3500, ore: 90, parts: ['cargo_hold'], items: ['plasmacoil', 'fluxcap'] } }
  ];

  SF.ANOMALY = { systemId: 'drift', x: 2500, y: 2500 };

  var PROMPT_R = 200;

  function secs() {
    // live player secrets blob (save v5)
    var s = SF.Player.secretsState;
    if (!s) { s = { investigated: {}, anomalyDone: false, found: 0 }; }
    return s;
  }

  function giveLoot(loot, label) {
    var p = SF.Player;
    var got = [];
    if (loot.credits) { p.credits += loot.credits; got.push(fmt(loot.credits) + 'c'); }
    if (loot.ore) { p.ore += loot.ore; got.push(fmt(loot.ore) + ' ore'); }
    (loot.parts || []).forEach(function (id) { p.addPart(id, 1); got.push(SF.PART_BY_ID[id].name); });
    (loot.items || []).forEach(function (id) {
      p.inventory[id] = (p.inventory[id] || 0) + 1;
      got.push(SF.ITEM_BY_ID[id].name);
    });
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('📦 Salvaged ' + label + ': ' + got.join(', '));
    if (SF.Audio && SF.Audio.salvage) SF.Audio.salvage();
  }

  var Secrets = {

    /* unlooted derelicts currently in this system */
    derelictsHere: function (systemId) {
      var s = secs();
      return SF.DERELICTS.filter(function (d) {
        return d.systemId === systemId && !s.investigated[d.id];
      });
    },

    anomalyHere: function (systemId) {
      var s = secs();
      return (SF.ANOMALY.systemId === systemId && !s.anomalyDone) ? SF.ANOMALY : null;
    },

    /* {kind:'derelict'|'anomaly', d, dist} or null */
    nearSecret: function (player, systemId) {
      var best = null;
      function consider(x, y, kind, d) {
        var dx = player.x - x, dy = player.y - y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= PROMPT_R && (!best || dist < best.dist)) best = { kind: kind, d: d, dist: dist };
      }
      this.derelictsHere(systemId).forEach(function (d) { consider(d.x, d.y, 'derelict', d); });
      var an = this.anomalyHere(systemId);
      if (an) consider(an.x, an.y, 'anomaly', an);
      return best;
    },

    investigate: function (target) {
      if (!target) return;
      if (target.kind === 'derelict') this._derelict(target.d);
      else this._anomaly();
    },

    _derelict: function (d) {
      var s = secs();
      var self = this;
      SF.Dialogue.open({
        title: '☠ ' + d.name.toUpperCase(),
        text: d.log,
        choices: [{
          label: 'Take the salvage',
          run: function () {
            giveLoot(d.loot, d.name);
            s.investigated[d.id] = true;
            s.found = (s.found || 0) + 1;
            // planets-facilities: derelict discoveries make the wire
            if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 Salvage wire: the derelict \u201C' + d.name +
              '\u201D was stripped clean in ' + SF.SYSTEM_BY_ID[SF.Game.systemId].name + '.');
            SF.Save.save();
            SF.Dialogue.close();
          }
        }, {
          label: 'Leave it adrift',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    _anomaly: function () {
      var s = secs();
      var self = this;
      SF.Dialogue.open({
        title: '✦ THE ANOMALY',
        text: 'Something hangs in the Drift that shouldn\'t be there — a knot of ' +
              'bent starlight, humming at the edge of hearing. It feels… aware. ' +
              'Your hand is already moving toward it.',
        choices: [{
          label: 'TOUCH it',
          run: function () {
            if (SF.Audio && SF.Audio.anomaly) SF.Audio.anomaly();
            var roll = Math.random();
            if (roll < 0.50) {
              // 50%: cache
              giveLoot({ credits: rint(800, 1600), ore: rint(20, 40), parts: ['fission_cell'] }, 'the anomaly');
            } else if (roll < 0.80) {
              // 30%: hull damage + raider ambush
              SF.Player.takeDamage(30);
              if (window.SF && SF.Enemies && SF.Enemies.spawnPatrol)
                SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 250, SF.Player.y);
              if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The anomaly bites back — raiders!');
              if (SF.Audio && SF.Audio.alert) SF.Audio.alert();
            } else {
              // 20%: karma
              if (window.SF && SF.Factions) SF.Factions.shiftKarma(10);
              if (SF.HUD && SF.HUD.toast) SF.HUD.toast('✦ The anomaly approves. Karma +10');
            }
            s.anomalyDone = true;
            s.found = (s.found || 0) + 1;
            SF.Save.save();
            SF.Dialogue.close();
          }
        }, {
          label: 'Leave it alone',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    draw: function (ctx, systemId, time) {
      var self = this;
      this.derelictsHere(systemId).forEach(function (d) {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(0.5);
        // broken husk: dark jagged hull
        ctx.fillStyle = '#2a2f3a';
        ctx.beginPath();
        ctx.moveTo(26, 0); ctx.lineTo(-14, -14); ctx.lineTo(-26, -6);
        ctx.lineTo(-20, 6); ctx.lineTo(-12, 14);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#8a93a8'; ctx.lineWidth = 1.5; ctx.stroke();
        // faint blinking beacon
        var blink = (Math.floor(time * 1.5) % 2 === 0);
        ctx.fillStyle = blink ? '#ffd23f' : '#4a3a10';
        ctx.beginPath(); ctx.arc(8, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#8a93a8';
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText(d.name, d.x, d.y - 34);
      });
      var an = this.anomalyHere(systemId);
      if (an) {
        var pulse = 0.5 + 0.5 * Math.sin(time * 3);
        ctx.save();
        ctx.translate(an.x, an.y);
        ctx.strokeStyle = 'rgba(180,92,255,' + (0.5 + 0.5 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 2;
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, 14 + i * 10 + pulse * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#b45cff';
        ctx.beginPath(); ctx.arc(0, 0, 6 + pulse * 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#b45cff';
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('✦ ANOMALY', an.x, an.y - 52);
      }
    }
  };

  SF.Secrets = Secrets;
})();

/* ============================================================
 * STARFALL — ghost-signal-hunt phase: SF.GhostSignals
 *
 * Secrets layer 3: a hidden ARG on top of the secrets framework.
 *
 *  - GHOST SIGNALS: ultra-rare (0.5% per jump) anomalies that spawn
 *    in deep-space systems (drift, ember), only during the
 *    night-cycle, never while a campaign mission is active.
 *  - Interacting with 3 signals (any order) yields 3 fragments of a
 *    corrupted transmission; collecting all 3 unlocks a one-time
 *    derelict encounter (THE SILENT CHOIR) with a unique boss
 *    (THE HOLLOW SIGNAL) and a secret ship hull (ghostwraith) reward.
 *  - The existing whisper_01..04 voice lines play as proximity
 *    hints when a live signal is near but out of prompt range.
 *
 * Purely additive: wraps SF.Secrets.nearSecret / investigate / draw
 * (secrets2.js loads after this file and wraps us in turn — the
 * chain composes). Nothing above is refactored.
 *
 * Save: the ghost state lives as an additive `ghost` key on the
 * existing secrets blob (SF.Player.secretsState) with defensive
 * reads, so old saves keep working. No SF.SAVE_VERSION bump — a
 * future js/save.js phase can formalize the version step.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var GHOST_DEEP = ['drift', 'ember']; // deep-space systems (solace = core)
  var SPAWN_CHANCE = 0.005;            // 0.5% per jump
  var PROMPT_R = 200;                  // same prompt radius as the secrets layers
  var WHISPER_R = 1500;                // proximity-hint radius
  var WHISPER_COOLDOWN_MS = 20000;     // one hint every 20s max
  var NIGHT_CYCLE = 1200;              // in-game seconds per full day/night cycle
  var BOSS_OID = 'ghost_signal_boss';
  var HULL_ID = 'ghostwraith';

  var FRAGMENTS = [
    { id: 'frag_1',
      text: '\u2026MAYDAY \u2026MAYDAY \u2026this is the [STATIC] \u2026we followed the ' +
            'whisper out past Ember and the stars went WRONG\u2026 the charts ' +
            'don\u2019t match, the charts never matched, why did we think the ' +
            'charts matched\u2026' },
    { id: 'frag_2',
      text: '\u2026hull is singing \u2026crew is singing \u2026it wears our voices ' +
            'now \u2026do not answer the [STATIC] \u2026do not let it learn your ' +
            'name, it only needs the one\u2026' },
    { id: 'frag_3',
      text: '\u2026if you hear this, we are the [SIGNAL LOST] \u2026come and take ' +
            'the ship \u2026it flies itself now \u2026IT FLIES ITSELF NOW\u2026 ' +
            '\u2026[SIGNAL LOST]\u2026' }
  ];

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* ---- additive state: `ghost` key on the secrets blob, defensive ---- */
  function gsecs() {
    var s = null;
    try { s = SF.Player && SF.Player.secretsState; } catch (e) { s = null; }
    if (!s) {
      s = { investigated: {}, anomalyDone: false, found: 0 };
      try { if (SF.Player) SF.Player.secretsState = s; } catch (e) { /* detached */ }
    }
    if (!s.ghost || typeof s.ghost !== 'object') {
      s.ghost = {
        signal: null,          // {systemId,x,y,seed} live uncollected signal
        fragments: [],         // collected fragment ids in capture order
        derelict: null,        // {systemId,x,y} once all 3 fragments held
        derelictDone: false,
        bossSpawned: false,
        bossDown: false,
        hullGranted: false,
        signalsSeen: 0         // lifetime counter (ARG flavor)
      };
    }
    var g = s.ghost;
    if (!Array.isArray(g.fragments)) g.fragments = [];
    return g;
  }

  function baseFound(n) {
    // mirror the other layers: every discovery ticks the shared counter
    try {
      var s = SF.Player && SF.Player.secretsState;
      if (s) s.found = (s.found || 0) + (n || 1);
    } catch (e) { /* never break the hunt on a counter hiccup */ }
  }

  /* ---- night-cycle: second half of a 20-minute in-game cycle ---- */
  function isNight(time) {
    var t = (typeof time === 'number' && isFinite(time)) ? time : 0;
    return (t % NIGHT_CYCLE) >= (NIGHT_CYCLE / 2);
  }

  /* ---- campaign-mission guard: Fall chain / faction arcs / finale ---- */
  function campaignMissionActive() {
    try {
      var st = SF.Player && SF.Player.storyState;
      if (!st || typeof st !== 'object') return false;
      if (st.fall >= 1 && st.fall <= 6) return true;      // Fall chain in progress
      var arcs = st.arcs || {};
      for (var k in arcs) {
        if (arcs[k] >= 1 && arcs[k] <= 3) return true;    // arc started, not done (4)
      }
      if (st.finale && !st.finaleDone) return true;       // finale armed
      return false;
    } catch (e) { return false; }
  }

  function farFromStation(systemId) {
    var ws = (SF.CONFIG && SF.CONFIG.worldSize) || 4200;
    var st = null;
    try { st = SF.Station && SF.Station.getStation(systemId); } catch (e) { st = null; }
    for (var tries = 0; tries < 12; tries++) {
      var x = 120 + Math.random() * (ws - 240);
      var y = 120 + Math.random() * (ws - 240);
      if (!st || Math.hypot(x - st.x, y - st.y) >= 900) return { x: x, y: y };
    }
    return { x: ws / 2 + 500, y: ws / 2 - 500 };
  }

  function playWhisper() {
    var n = 1 + Math.floor(Math.random() * 4);
    try { if (SF.Audio && SF.Audio.voice) SF.Audio.voice('whisper_0' + n); }
    catch (e) { /* voice pack is best-effort */ }
  }

  var Ghost = {

    /* public for smoke tests */
    isNight: isNight,
    campaignMissionActive: campaignMissionActive,
    state: function () { return gsecs(); },

    /* ---- jump roll: 0.5%/jump, deep-space, night, no campaign mission ---- */
    onJump: function (systemId, time, forced) {
      var g = gsecs();
      if (g.derelictDone) return false;                 // hunt complete
      if (g.signal) return false;                        // one live signal at a time
      if (GHOST_DEEP.indexOf(systemId) < 0) return false;
      if (!isNight(time)) return false;
      if (campaignMissionActive()) return false;
      var roll = (typeof forced === 'number') ? forced : Math.random();
      if (roll >= SPAWN_CHANCE) return false;
      var pos = farFromStation(systemId);
      g.signal = { systemId: systemId, x: pos.x, y: pos.y,
                   seed: (Math.random() * 1e9) | 0 };
      g.signalsSeen++;
      playWhisper();
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u2026you catch a whisper on the long-range band. Something is out there.');
      try { SF.Save.save(); } catch (e) {}
      return true;
    },

    nearSecret: function (player, systemId) {
      var g = gsecs(), best = null;
      function consider(x, y, kind, d) {
        var dist = Math.hypot(player.x - x, player.y - y);
        if (dist <= PROMPT_R && (!best || dist < best.dist)) best = { kind: kind, d: d, dist: dist };
      }
      if (g.signal && g.signal.systemId === systemId)
        consider(g.signal.x, g.signal.y, 'ghostsignal', g.signal);
      if (g.derelict && !g.derelictDone && g.derelict.systemId === systemId)
        consider(g.derelict.x, g.derelict.y, 'ghostderelict', g.derelict);
      return best;
    },

    investigate: function (target) {
      if (!target) return;
      if (target.kind === 'ghostsignal') this._signal(target.d);
      else if (target.kind === 'ghostderelict') this._derelict(target.d);
    },

    _signal: function (sig) {
      var g = gsecs();
      var n = g.fragments.length + 1;
      var frag = FRAGMENTS[Math.min(n - 1, FRAGMENTS.length - 1)];
      SF.Dialogue.open({
        title: '\u25C9 GHOST SIGNAL',
        text: 'The static resolves into something almost like a voice \u2014 ' +
              'no, into something wearing a voice. It is broadcasting on a ' +
              'dead band, and it has been broadcasting for a very long time. ' +
              'Your recorder snatches a fragment before the signal dissolves ' +
              'back into the noise:\n\n\u201C' + frag.text + '\u201D',
        choices: [{
          label: 'Capture the fragment (' + n + '/3)',
          run: function () {
            playWhisper();
            g.fragments.push(frag.id);
            g.signal = null;
            baseFound(1);
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('\u25C9 SIGNAL FRAGMENT ' + g.fragments.length + '/3 CAPTURED');
            if (g.fragments.length >= 3) Ghost._unlockDerelict();
            try { SF.Save.save(); } catch (e) {}
            SF.Dialogue.close();
          }
        }, {
          label: 'Let it fade',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    _unlockDerelict: function () {
      var g = gsecs();
      if (g.derelict) return;
      var sys = (SF.Game && SF.Game.systemId) || 'drift';
      var pos = farFromStation(sys);
      g.derelict = { systemId: sys, x: pos.x, y: pos.y,
                     name: 'The Silent Choir' };
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u25C9 THE TRANSMISSION IS WHOLE \u2014 a derelict answers from the dark.');
      if (SF.Audio && SF.Audio.voice) { try { SF.Audio.voice('whisper_04'); } catch (e) {} }
      try {
        if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 Ghost-wire: a dead ship is singing ' +
          'in ' + (SF.SYSTEM_BY_ID[sys] ? SF.SYSTEM_BY_ID[sys].name : sys) +
          '. Three fragments. One voice. Nobody is claiming it.');
      } catch (e) {}
    },

    _derelict: function (dg) {
      var self = this;
      SF.Dialogue.open({
        title: '\u2620 THE SILENT CHOIR',
        text: 'She hangs in the black with her running lights on, and that ' +
              'is the first wrong thing \u2014 nothing dead keeps its lights ' +
              'on. The hull is scored with writing in no alphabet you know, ' +
              'and the writing moves when you don\u2019t look at it. The ' +
              'transmission led you here. The transmission is still ' +
              'broadcasting, from inside. Something in the dark just stood ' +
              'up to meet you.',
        choices: [{
          label: 'Board her',
          run: function () { self._spawnBoss(); }
        }, {
          label: 'Not yet',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    _spawnBoss: function () {
      var g = gsecs();
      var boss = this._bossAlive();
      if (!boss) {
        var mul = (SF.CONFIG.systems && SF.CONFIG.systems[SF.Game.systemId] &&
                   SF.CONFIG.systems[SF.Game.systemId].enemyMul) || 1;
        try {
          boss = SF.Enemies.spawn('gunship', SF.Player.x + 340, SF.Player.y,
                                  5.0 * mul, { storyOid: BOSS_OID });
        } catch (e) { boss = null; }
        g.bossSpawned = true;
        baseFound(1);
        try { SF.Save.save(); } catch (e) {}
      }
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u25C9 THE HOLLOW SIGNAL rises from the dark!');
      try { if (SF.Audio && SF.Audio.alert) SF.Audio.alert(); } catch (e) {}
      SF.Dialogue.close();
    },

    _bossAlive: function () {
      var list = (SF.Enemies && SF.Enemies.list) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].storyOid === BOSS_OID && list[i].hp > 0) return list[i];
      }
      return null;
    },

    bossDown: function () {
      var g = gsecs();
      if (g.bossDown) return;
      g.bossDown = true;
      g.derelictDone = true;
      baseFound(1);
      // reward: the secret hull (registered below, hidden from the shipyard
      // by construction — it lives in SHIP_CLASS_BY_ID, not SHIP_CLASSES)
      var already = false;
      try {
        already = (SF.Player.ships || []).some(function (s) { return s.classId === HULL_ID; });
      } catch (e) { already = false; }
      if (!already && SF.Player.buyShip(HULL_ID, 0)) {
        g.hullGranted = true;
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('\u25C9 SECRET HULL ACQUIRED: GHOSTWRAITH \u2014 check the shipyard roster.');
      } else {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('\u25C9 The Hollow Signal is silent. The void pays in credits: +' +
                       fmt(25000) + 'c');
        try { SF.Player.credits += 25000; } catch (e) {}
      }
      try { if (SF.Audio && SF.Audio.buy) SF.Audio.buy(); } catch (e) {}
      try {
        if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 Ghost-wire: the singing derelict ' +
          'went quiet. Whoever boarded her came back flying something new.');
      } catch (e) {}
      try { SF.Save.save(); } catch (e) {}
    },

    /* per-frame: jump detection + proximity whisper hints */
    _tick: function (systemId, time) {
      if (systemId !== Ghost._lastSys) {
        Ghost._lastSys = systemId;
        if (Ghost._lastSysInit) this.onJump(systemId, time);
        Ghost._lastSysInit = true;
      }
      var g = gsecs();
      if (g.signal && g.signal.systemId === systemId && SF.Player) {
        var d = Math.hypot(SF.Player.x - g.signal.x, SF.Player.y - g.signal.y);
        var now = Date.now();
        if (d < WHISPER_R && d > PROMPT_R && now - (Ghost._lastWhisper || 0) > WHISPER_COOLDOWN_MS) {
          Ghost._lastWhisper = now;
          playWhisper();
        }
      }
    },
    _lastSys: null,
    _lastSysInit: false,
    _lastWhisper: 0,

    /* test hooks: force a signal / complete the chain without the 0.5% lottery */
    debug: function () {
      var g = gsecs();
      return {
        signal: g.signal ? { systemId: g.signal.systemId } : null,
        fragments: g.fragments.slice(),
        derelict: !!g.derelict,
        derelictDone: g.derelictDone,
        bossSpawned: g.bossSpawned,
        bossDown: g.bossDown,
        hullGranted: g.hullGranted,
        isNight: isNight,
        spawnChance: SPAWN_CHANCE
      };
    },
    debugForceSignal: function (systemId) {
      var g = gsecs();
      var pos = farFromStation(systemId || 'drift');
      g.signal = { systemId: systemId || 'drift', x: pos.x, y: pos.y, seed: 1 };
      g.signalsSeen++;
      return g.signal;
    },
    debugGrantFragments: function (n) {
      var g = gsecs();
      for (var i = g.fragments.length; i < (n || 3); i++)
        g.fragments.push(FRAGMENTS[Math.min(i, FRAGMENTS.length - 1)].id);
      if (g.fragments.length >= 3) this._unlockDerelict();
      return g.fragments.slice();
    }
  };

  SF.GhostSignals = Ghost;

  /* ---- secret hull: registered by-id only, never in SF.SHIP_CLASSES,
   * so the station shipyard (which iterates the array) can't sell it ---- */
  if (SF.SHIP_CLASS_BY_ID && !SF.SHIP_CLASS_BY_ID[HULL_ID]) {
    SF.SHIP_CLASS_BY_ID[HULL_ID] = {
      id: HULL_ID, name: 'Ghostwraith', gridW: 5, gridH: 5,
      speed: 265, hull: 230, shield: 120, crewReq: 2, cargoBonus: 20,
      price: 0, color: '#b48cff', secretOnly: true,
      desc: 'SECRET HULL. A ship that flew itself out of a ghost signal. ' +
            'The writing on the bulkheads moves when you don\u2019t look.'
    };
  }

  /* ---- integrate: wrap the (still original) SF.Secrets methods ---- */
  var origNear = SF.Secrets.nearSecret.bind(SF.Secrets);
  SF.Secrets.nearSecret = function (player, systemId) {
    var a = origNear(player, systemId);
    var b = Ghost.nearSecret(player, systemId);
    if (a && b) return (a.dist <= b.dist) ? a : b;
    return a || b;
  };

  var origInvestigate = SF.Secrets.investigate.bind(SF.Secrets);
  SF.Secrets.investigate = function (target, forcedRoll) {
    if (!target) return;
    if (target.kind === 'ghostsignal' || target.kind === 'ghostderelict')
      return Ghost.investigate(target);
    return origInvestigate(target, forcedRoll);
  };

  /* The wrap above sits INSIDE secrets2.js's investigate dispatcher
   * (secrets2 loads after this file), and that dispatcher silently drops
   * kinds it doesn't know — so ghost targets would never reach us through
   * the live chain. Re-wrap once the page is fully loaded so the ghost
   * dispatcher is outermost; unknown kinds keep delegating inward.
   * Registered during this script's evaluation, i.e. before campaign.js's
   * own DOMContentLoaded hook, so the codex watch-hook stays outermost. */
  function ghostOuterWrap() {
    var cur = SF.Secrets.investigate;
    if (!cur || cur.__ghostOuter) return;
    var inner = cur;
    var outer = function (target, forcedRoll) {
      if (target && (target.kind === 'ghostsignal' || target.kind === 'ghostderelict'))
        return Ghost.investigate(target);
      return inner.call(this, target, forcedRoll);
    };
    outer.__ghostOuter = true;
    SF.Secrets.investigate = outer;
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ghostOuterWrap);
  else
    ghostOuterWrap();

  var origDraw = SF.Secrets.draw.bind(SF.Secrets);
  SF.Secrets.draw = function (ctx, systemId, time) {
    origDraw(ctx, systemId, time);
    Ghost._tick(systemId, time);
    Ghost.draw(ctx, systemId, time);
  };

  var origKill = SF.Enemies.kill.bind(SF.Enemies);
  SF.Enemies.kill = function (e) {
    var isBoss = !!(e && e.storyOid === BOSS_OID);
    origKill.call(SF.Enemies, e);
    if (isBoss) Ghost.bossDown();
  };

  /* ---- drawing: signal + derelict markers ---- */
  Ghost.draw = function (ctx, systemId, time) {
    var g = gsecs();
    if (g.signal && g.signal.systemId === systemId) {
      var s = g.signal;
      var pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.strokeStyle = 'rgba(125,249,255,' + (0.35 + 0.4 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 1.6;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 12 + i * 12 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      // glitch core: jittered diamond
      var jx = (Math.random() - 0.5) * 4, jy = (Math.random() - 0.5) * 4;
      ctx.fillStyle = '#d8fbff';
      ctx.beginPath();
      ctx.moveTo(jx, jy - 7); ctx.lineTo(jx + 5, jy);
      ctx.lineTo(jx, jy + 7); ctx.lineTo(jx - 5, jy);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#7df9ff';
      ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('\u25C9 GHOST SIGNAL', s.x, s.y - 56);
      ctx.fillStyle = '#4a7a80';
      ctx.font = '11px monospace';
      ctx.fillText('fragments ' + g.fragments.length + '/3', s.x, s.y + 66);
    }
    if (g.derelict && !g.derelictDone && g.derelict.systemId === systemId) {
      var d = g.derelict;
      var pl = 0.5 + 0.5 * Math.sin(time * 1.4);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(-0.25);
      var gg = ctx.createRadialGradient(0, 0, 8, 0, 0, 80);
      gg.addColorStop(0, 'rgba(125,249,255,' + (0.18 + 0.12 * pl).toFixed(2) + ')');
      gg.addColorStop(1, 'rgba(125,249,255,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill();
      // broken husk, larger than the phase-5 derelicts
      ctx.fillStyle = '#1d2530';
      ctx.beginPath();
      ctx.moveTo(44, 0); ctx.lineTo(-24, -22); ctx.lineTo(-44, -10);
      ctx.lineTo(-34, 10); ctx.lineTo(-20, 24);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 1.5; ctx.stroke();
      // lit windows — nothing dead keeps its lights on
      var lit = (Math.floor(time * 1.2) % 3 !== 2);
      ctx.fillStyle = lit ? '#d8fbff' : '#223038';
      for (var w = 0; w < 4; w++) {
        ctx.fillRect(-30 + w * 12, -3, 6, 6);
      }
      ctx.restore();
      ctx.fillStyle = '#7df9ff';
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('\u2620 THE SILENT CHOIR', d.x, d.y - 96);
    }
  };

})();
/* ============================================================
 * STARFALL — ghost-ships phase: SF.GhostShips
 *
 * Secrets layer 4: rare spectral derelicts haunting Drift and Ember.
 *
 *  - SPAWN: on jump into drift/ember, a 1-in-12 roll (runtime seeded)
 *    phases a spectral derelict into existence at a random point far
 *    from any station. One per session: once one has spawned (boarded
 *    or faded), no more spawn until the next session.
 *  - VISUAL: phase-in/out alpha flicker; the hull is a pale ghostly
 *    outline that never fully solidifies. Phase-in plays a whisper
 *    SFX via guarded SF.Audio.sfx('ghost_phasein') with the router's
 *    synth fallback (plus a guarded whisper voice line for feel).
 *  - BOARD: E-key investigate opens the captain's lore log; boarding
 *    grants ONE rare part/mod drawn from the weapons-arsenal drop
 *    tables (gunship mod table / blue+ ship parts), ticks the shared
 *    secretsFound counter, and the ship never returns.
 *  - DESPAWN: ignored for 60s of game time -> it phases out (no
 *    respawn this session). Test hook debugExpire() accelerates this.
 *
 * Purely additive: wraps SF.Secrets.nearSecret / draw at load, and
 * re-wraps SF.Secrets.investigate at DOMContentLoaded (outermost, the
 * same pattern the ghost-signal layer uses — secrets2.js's dispatcher
 * drops unknown kinds, so ghost-ships must sit above it). Nothing
 * above is refactored.
 *
 * Save: save-neutral. The derelict is runtime-only (never written to
 * the save blob). Boarding ticks the existing secretsState.found
 * counter — a field that has existed since save v5 — so no
 * SF.SAVE_VERSION bump is needed.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var DEEP = ['drift', 'ember']; // spectral waters
  var SPAWN_CHANCE = 1 / 12;     // 1-in-12 derelict spawn roll per jump
  var PROMPT_R = 200;            // same prompt radius as the other secret layers
  var DESPAWN_S = 60;            // ignored -> phases out after 60s of game time
  var PHASE_S = 3;               // phase-in/out visual duration (seconds)
  var FADE_WARN_S = 15;          // show the fading countdown under this

  /* seeded PRNG (mulberry32) for the spawn layout */
  function rng32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var LORE = [
    { name: 'The Vesper',
      log: 'CAPTAIN\'S LOG — THE VESPER. We jumped out of Ember with a hold ' +
           'full of nothing and a crew full of static. Halfway through the ' +
           'burn the stars went out one by one, like somebody was counting ' +
           'them down. We are still jumping. We have always been jumping. ' +
           'If you can read this, you are jumping too — you just don\'t ' +
           'know it yet.' },
    { name: 'The Half-Light',
      log: 'CAPTAIN\'S LOG — THE HALF-LIGHT. The new drive worked. That\'s ' +
           'the worst part — it worked exactly as designed. It put us ' +
           'between. There is no between on the charts. The crew can see ' +
           'through their own hands now, and the reactor sings in a voice ' +
           'like my mother\'s. We are not lost. We are the place ships get ' +
           'lost FROM.' },
    { name: 'The Long Wake',
      log: 'CAPTAIN\'S LOG — THE LONG WAKE. Day nine thousand and something. ' +
           'The distress beacon has been broadcasting the whole time. We ' +
           'only just noticed it was broadcasting US. Every mayday we ever ' +
           'answered out here was this ship. Every rescue was this ship. ' +
           'Stop answering. Take what isn\'t nailed to the between and go.' },
    { name: 'The Pale Meridian',
      log: 'CAPTAIN\'S LOG — THE PALE MERIDIAN. We found the meridian the ' +
           'old charts whisper about — the line where the Drift stops being ' +
           'a place and starts being a decision. We crossed it. On this ' +
           'side the ship flies itself, the cargo loads itself, and the ' +
           'captain\'s log writes itself. I am the captain\'s log. Take the ' +
           'parts. They are the only thing here that ever belonged to ' +
           'anyone.' }
  ];

  /* runtime-only state: never written to the save blob (save-neutral) */
  var R = {
    derelict: null,  // {systemId,x,y,seed,name,log,spawnedAt,sfxPlayed} | null
    spawned: false,   // one spectral per session
    seen: 0          // lifetime spawn counter (this session)
  };

  function ghostSfx() {
    // brief: whisper SFX via guarded SF.Audio.sfx('ghost_phasein') with
    // the audio router's synth fallback (silent-but-safe until an
    // sfx-bank phase ships the real file). A guarded whisper voice line
    // rides along for immediate audible feel.
    try { if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('ghost_phasein'); } catch (e) {}
    try {
      if (SF.Audio && SF.Audio.voice)
        SF.Audio.voice('whisper_0' + (1 + Math.floor(Math.random() * 4)));
    } catch (e) { /* voice pack is best-effort */ }
  }

  function foundTick() {
    try {
      var s = SF.Player && SF.Player.secretsState;
      if (s) s.found = (s.found || 0) + 1;
    } catch (e) { /* never break the board on a counter hiccup */ }
  }

  function toast(msg) {
    try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
  }

  function spawnPos(systemId, seed) {
    var rnd = rng32(seed);
    var ws = (SF.CONFIG && SF.CONFIG.worldSize) || 4200;
    var st = null;
    try { st = (SF.Station && SF.Station.getStation) ? SF.Station.getStation(systemId) : null; }
    catch (e) { st = null; }
    for (var tries = 0; tries < 12; tries++) {
      var x = 120 + rnd() * (ws - 240);
      var y = 120 + rnd() * (ws - 240);
      if (!st || Math.hypot(x - st.x, y - st.y) >= 900) return { x: x, y: y };
    }
    return { x: ws / 2 + 700, y: ws / 2 - 700 };
  }

  /* one rare part/mod from the weapons-arsenal drop logic:
   * 50/50 between the gunship mod table and a blue+ ship part */
  function rollSpectralDrop() {
    if (Math.random() < 0.5 && SF.MOD_DROPS && SF.MOD_DROPS.gunship) {
      var mids = SF.MOD_DROPS.gunship.filter(function (id) {
        var m = SF.MOD_BY_ID[id];
        return m && !m.secretOnly;
      });
      if (mids.length) return { kind: 'mod', id: mids[(Math.random() * mids.length) | 0] };
    }
    var rares = (SF.PARTS || []).filter(function (p) {
      return p.tier === 'blue' || p.tier === 'purple' ||
             p.tier === 'orange' || p.tier === 'gold';
    });
    if (rares.length) return { kind: 'part', id: rares[(Math.random() * rares.length) | 0].id };
    return { kind: 'credits', n: 5000 };
  }

  function grantDrop(drop) {
    var p = SF.Player;
    if (drop.kind === 'mod') {
      if (SF.Mods && SF.Mods.addMod) SF.Mods.addMod(drop.id);
      var m = SF.MOD_BY_ID[drop.id];
      toast('◈ SPECTRAL SALVAGE — weapon mod: ' + (m ? m.name : drop.id));
    } else if (drop.kind === 'part') {
      p.addPart(drop.id, 1);
      var pt = SF.PART_BY_ID[drop.id];
      toast('◈ SPECTRAL SALVAGE — ship part: ' + (pt ? pt.name : drop.id));
    } else {
      p.credits += drop.n;
      toast('◈ SPECTRAL SALVAGE — ' + drop.n.toLocaleString('en-US') + 'c');
    }
    try { if (SF.Audio && SF.Audio.salvage) SF.Audio.salvage(); } catch (e) {}
  }

  var GhostShips = {

    /* test hooks */
    debug: function () {
      return {
        derelict: R.derelict ? {
          systemId: R.derelict.systemId, name: R.derelict.name,
          seed: R.derelict.seed, x: R.derelict.x, y: R.derelict.y
        } : null,
        spawned: R.spawned,
        seen: R.seen,
        spawnChance: SPAWN_CHANCE
      };
    },
    debugForceSpawn: function (systemId, x, y) {
      R.spawned = true;
      var seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      var pos = (typeof x === 'number' && typeof y === 'number') ?
        { x: x, y: y } : spawnPos(systemId || 'drift', seed);
      var lore = LORE[seed % LORE.length];
      R.derelict = { systemId: systemId || 'drift', x: pos.x, y: pos.y,
                     seed: seed, name: lore.name, log: lore.log,
                     spawnedAt: null, sfxPlayed: false };
      R.seen++;
      return R.derelict;
    },
    debugExpire: function () {
      // accelerated timer hook: make the derelict expire on the next tick
      if (!R.derelict) return false;
      R.derelict.spawnedAt = (R.derelict.spawnedAt === null ? 0 : R.derelict.spawnedAt) -
                             (DESPAWN_S + 1);
      return true;
    },
    debugReset: function (full) {
      R.derelict = null;
      if (full) R.spawned = false; // full session reset; default keeps the session flag
    },

    /* 1-in-12 jump roll; forced overrides the roll (tests) */
    onJump: function (systemId, forced) {
      if (DEEP.indexOf(systemId) < 0) return false;
      if (R.derelict) return false;   // one live spectral at a time
      if (R.spawned) return false;    // no respawn this session
      var roll = (typeof forced === 'number') ? forced : Math.random();
      if (roll >= SPAWN_CHANCE) return false;
      this.debugForceSpawn(systemId);
      ghostSfx();
      toast('◈ A spectral derelict phases into reality…');
      return true;
    },

    nearSecret: function (player, systemId) {
      var d = R.derelict;
      if (!d || d.systemId !== systemId) return null;
      var dist = Math.hypot(player.x - d.x, player.y - d.y);
      return (dist <= PROMPT_R) ? { kind: 'spectral', d: d, dist: dist } : null;
    },

    investigate: function (target) {
      if (!target || target.kind !== 'spectral') return;
      this._board(target.d);
    },

    _board: function (d) {
      var self = this;
      SF.Dialogue.open({
        title: '◈ ' + d.name.toUpperCase(),
        text: 'She isn\'t entirely here. The hull phases in and out like a ' +
              'bad memory — sometimes you can see straight through the ' +
              'bulkheads to the stars beyond. But the airlock answers, and ' +
              'the log core is warm. Someone wanted this found.\n\n' + d.log,
        choices: [{
          label: 'Board the phantom',
          run: function () {
            var drop = rollSpectralDrop();
            grantDrop(drop);
            foundTick();
            R.derelict = null; // boarded: never returns
            try {
              if (window.SF && SF.News) SF.News.push('◈ Ghost-wire: the spectral derelict \u201C' +
                d.name + '\u201D was boarded in ' +
                (SF.SYSTEM_BY_ID[d.systemId] ? SF.SYSTEM_BY_ID[d.systemId].name : d.systemId) +
                '. The phantom did not stay to be thanked.');
            } catch (e) {}
            try { SF.Save.save(); } catch (e) {}
            SF.Dialogue.close();
          }
        }, {
          label: 'Let it drift',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    /* per-frame: jump detection + phase-in sfx + 60s despawn */
    _tick: function (systemId, time) {
      if (systemId !== GhostShips._lastSys) {
        GhostShips._lastSys = systemId;
        if (GhostShips._lastSysInit) this.onJump(systemId);
        GhostShips._lastSysInit = true;
      }
      var d = R.derelict;
      if (!d || d.systemId !== systemId) return;
      if (d.spawnedAt === null) d.spawnedAt = time;
      if (!d.sfxPlayed) { d.sfxPlayed = true; ghostSfx(); }
      if (time - d.spawnedAt >= DESPAWN_S) {
        R.derelict = null;
        ghostSfx();
        toast('◈ The spectral derelict phases out of reality…');
      }
    },
    _lastSys: null,
    _lastSysInit: false,

    draw: function (ctx, systemId, time) {
      this._tick(systemId, time);
      var d = R.derelict;
      if (!d || d.systemId !== systemId) return;
      var age = (d.spawnedAt === null) ? 0 : (time - d.spawnedAt);
      var remaining = DESPAWN_S - age;
      var a;
      if (age < PHASE_S) a = age / PHASE_S;                              // phase in
      else if (remaining < PHASE_S) a = Math.max(0, remaining / PHASE_S); // phase out
      else a = 1;
      var flick = 0.70 + 0.30 * Math.sin(time * 17.3 + (d.seed % 7));
      var alpha = Math.max(0, Math.min(1, a * flick));

      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(0.35);
      ctx.globalAlpha = alpha;
      // ghostly glow
      var gg = ctx.createRadialGradient(0, 0, 6, 0, 0, 70);
      gg.addColorStop(0, 'rgba(190,240,255,0.30)');
      gg.addColorStop(1, 'rgba(190,240,255,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.fill();
      // phantom hull: pale outline, see-through plating
      ctx.strokeStyle = '#cfefff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(38, 0); ctx.lineTo(-18, -18); ctx.lineTo(-38, -8);
      ctx.lineTo(-28, 8); ctx.lineTo(-16, 18);
      ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = 'rgba(207,239,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, -10); ctx.lineTo(-10, -12); ctx.lineTo(-24, 2);
      ctx.moveTo(20, 10); ctx.lineTo(-8, 12); ctx.lineTo(-24, 2);
      ctx.stroke();
      // drifting soul-lights: never quite where you look
      var t = time * 2.1 + (d.seed % 13);
      for (var i = 0; i < 3; i++) {
        var lx = Math.cos(t + i * 2.1) * 26, ly = Math.sin(t * 1.3 + i * 1.7) * 18;
        ctx.fillStyle = 'rgba(220,250,255,' + (0.55 + 0.35 * Math.sin(t * 3 + i)).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = '#cfefff';
      ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('◈ SPECTRAL DERELICT', d.x, d.y - 52);
      if (remaining < FADE_WARN_S && remaining > 0) {
        ctx.fillStyle = '#7a9ab0';
        ctx.font = '11px monospace';
        ctx.fillText('phasing out in ' + Math.ceil(remaining) + 's', d.x, d.y + 64);
      }
      ctx.globalAlpha = 1;
    }
  };

  SF.GhostShips = GhostShips;

  /* ---------------- integration: wrap SF.Secrets ---------------- */

  var origNear = SF.Secrets.nearSecret.bind(SF.Secrets);
  SF.Secrets.nearSecret = function (player, systemId) {
    var a = origNear(player, systemId);
    var b = GhostShips.nearSecret(player, systemId);
    if (a && b) return (a.dist <= b.dist) ? a : b;
    return a || b;
  };

  var origDraw = SF.Secrets.draw.bind(SF.Secrets);
  SF.Secrets.draw = function (ctx, systemId, time) {
    origDraw(ctx, systemId, time);
    GhostShips.draw(ctx, systemId, time);
  };

  /* investigate: secrets2.js loads after this file and its dispatcher
   * silently drops unknown kinds — so re-wrap at DOMContentLoaded to sit
   * outermost, the same pattern the ghost-signal layer uses. Registered
   * after that layer's wrap (it appears earlier in this file), so this
   * one ends up on top and every kind still delegates inward. */
  function ghostShipsOuterWrap() {
    var cur = SF.Secrets.investigate;
    if (!cur || cur.__ghostShipsOuter) return;
    var inner = cur;
    var outer = function (target, forcedRoll) {
      if (target && target.kind === 'spectral') return GhostShips.investigate(target);
      return inner.call(this, target, forcedRoll);
    };
    outer.__ghostShipsOuter = true;
    SF.Secrets.investigate = outer;
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ghostShipsOuterWrap);
  else
    ghostShipsOuterWrap();

})();

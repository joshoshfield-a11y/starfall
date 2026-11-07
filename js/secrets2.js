/* ============================================================
 * STARFALL — secrets-easter-eggs phase: SF.Secrets2
 *
 * Deep secrets layered on top of SF.Secrets (loaded after secrets.js):
 *  - SF.ANOMALIES: 3 new anomalies (Weeping Bell / Choir of Glass /
 *    Pale Lantern), same 50/30/20 rarity model as the Drift anomaly.
 *  - SF.LIFEPOD: hidden-companion encounter. Touching the Pale Lantern
 *    can (20%) reveal a lifepod; investigating it recruits 'hushed',
 *    a hidden legend-tier wingman (never in the hire UI).
 *  - SF.DUNGEONS: "The Hollow Cathedral" — a 4-room derelict dungeon
 *    (Vestibule -> Reactor Nave -> Reliquary -> Sanctum) with
 *    escalating loot, an ambush, and a Warden boss fight.
 *  - Secret ultra weapons (gold, secretOnly: never sold/crafted/dropped):
 *      solar_requiem — dungeon room 3 (Reliquary)
 *      event_horizon  — dropped by the Warden (Sanctum boss)
 *  - SF.DungeonHack (dungeon-hack-minigame phase): rotating-dial tumbler
 *    lock gating the room 1-3 loot caches. 3 pins, stop the needle in the
 *    green arc; a missed pin fires the alarm and spawns defenders.
 *    Difficulty scales with dungeon depth. Runtime-only jam flags —
 *    save-neutral, no version bump.
 *  - Completionist easter egg: finding every secret flags VOIDWALKER.
 *
 * dungeon-depths-2 phase: SF.Secrets2 sanctum wing — a 3-room post-Warden
 * descent (Sanctum Antechamber -> Reliquary -> Choir Loft) entered through
 * the sealed stair once the Warden is down. Purely additive: new room
 * templates in the existing generator style, reliquary vaults gated by
 * SF.DungeonHack tumbler locks at depths 5-7 (difficultyFor clamp extended
 * 4->7; depths 1-4 behave exactly as before), alarm defenders reuse the
 * depth-scaled spawnDefenders, one guaranteed ultra weapon mod
 * (requiem_harmonics, gold, secretOnly) in the choir loft via
 * SF.Mods.addMod. Save-neutral: wing state is a runtime default in secs(),
 * no SF.SAVE_VERSION bump.
 *
 * Secrets state lives in SF.Player.secretsState (save v8; see migrateV7):
 *  { investigated, anomalyDone, found, anomalies2Done{}, lifepodSeen,
 *    lifepodDone, dungeon{room,bossSpawned,cleared,hint}, completionist }
 *
 * Integration: wraps SF.Secrets.nearSecret / investigate / draw and
 * SF.Enemies.kill (Warden death). No main.js changes required.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  /* ---------------- data ---------------- */

  SF.ANOMALIES = [
    { id: 'weeping_bell', name: 'The Weeping Bell', systemId: 'solace', x: 2450, y: 700,
      color: '#7df9ff',
      text: 'A bell-shaped fold in space, weeping slow light. It rings without ' +
            'sound, and the ringing is almost a voice. Almost a name. Almost yours.',
      outcomes: [
        { id: 'cache', label: 'TOUCH it',
          text: 'The Bell weeps for you. Light pours over the hull, knitting ' +
                'plates back together, and leaves something behind in the hold.',
          run: function () {
            var p = SF.Player;
            p.hull = Math.min(p.hull + 80, p.maxHull());
            p.shield = p.maxShield();
            giveLoot({ credits: rint(600, 1200), ore: rint(15, 30),
                       parts: ['ion_thruster'] }, 'the Bell');
          } },
        { id: 'bite', label: 'TOUCH it',
          text: 'The ringing turns to a scream. Something in the dark answers.',
          run: function () {
            SF.Player.takeDamage(25);
            if (SF.Enemies && SF.Enemies.spawnPatrol)
              SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 250, SF.Player.y);
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The Bell screams — raiders!');
          } },
        { id: 'grace', label: 'TOUCH it',
          text: 'The Bell stills. The silence it leaves behind feels like ' +
                'absolution, or the memory of it.',
          run: function () {
            if (SF.Factions) SF.Factions.shiftKarma(10);
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('✦ The Bell forgives. Karma +10');
          } } ] },
    { id: 'choir_glass', name: 'The Choir of Glass', systemId: 'ember', x: 2100, y: 2400,
      color: '#e8d8ff',
      text: 'Shards of frozen starlight hang in a ring, chiming against each ' +
            'other in a language older than ships. The song pulls at your teeth.',
      outcomes: [
        { id: 'cache', label: 'LISTEN closer',
          text: 'You match the Choir\u2019s pitch. A shard detaches and settles ' +
                'into your hold, heavy with refined ore.',
          run: function () {
            giveLoot({ credits: rint(800, 1500), ore: rint(60, 100) }, 'the Choir');
          } },
        { id: 'shriek', label: 'LISTEN closer',
          text: 'The song breaks into a shriek. Your shields gutter out like ' +
                'candles — and the dark is full of engines.',
          run: function () {
            SF.Player.shield = 0;
            SF.Player.takeDamage(10);
            if (SF.Enemies && SF.Enemies.spawnPatrol) {
              SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 250, SF.Player.y);
              SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x - 250, SF.Player.y + 150);
            }
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The Choir shrieks — shields down!');
          } },
        { id: 'song', label: 'LISTEN closer',
          text: 'For one breath the discord resolves into a single clear note — ' +
                'and the note is a set of coordinates, burned into your nav: ' +
                'DRIFT 700, 3400. Something vast and hollow waits there.',
          run: function () {
            var s = secs();
            s.dungeon.hint = true;
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('✦ The Choir sings coordinates: the Hollow Cathedral (Drift 700, 3400)');
          } } ] },
    { id: 'pale_lantern', name: 'The Pale Lantern', systemId: 'drift', x: 3900, y: 3900,
      color: '#b8ffc9',
      text: 'A cold green flame burns in the black with no fuel and no smoke. ' +
            'It does not flicker. It watches.',
      outcomes: [
        { id: 'cache', label: 'REACH for it',
          text: 'The flame leans toward your hand like a kept animal. It drops ' +
                'something warm and heavy into your cargo.',
          run: function () {
            giveLoot({ credits: rint(1000, 2000), ore: rint(30, 60),
                       items: ['plasmacoil'] }, 'the Lantern');
          } },
        { id: 'bite', label: 'REACH for it',
          text: 'The flame flares white. Behind you, drive signatures bloom.',
          run: function () {
            SF.Player.takeDamage(25);
            if (SF.Enemies && SF.Enemies.spawnPatrol)
              SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 250, SF.Player.y);
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The Lantern flares — raiders!');
          } },
        { id: 'signal', label: 'REACH for it',
          text: 'The flame dims — and through the dimness a ghost signal ' +
                'resolves: a lifepod, still powered, drifting at 3550, 3600. ' +
                'Someone is alive in there. Someone has been alive in there ' +
                'for a very long time.',
          run: function () {
            var s = secs();
            s.lifepodSeen = true;
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('✦ Ghost signal: lifepod at Drift 3550, 3600');
          } } ] }
  ];

  SF.LIFEPOD = { systemId: 'drift', x: 3550, y: 3600 };

  SF.DUNGEONS = [
    { id: 'hollow_cathedral', name: 'The Hollow Cathedral',
      systemId: 'drift', x: 700, y: 3400 }
  ];

  var WARDEN_OID = 'secrets2_warden';
  var PROMPT_R = 200;

  /* ---------------- state ---------------- */

  function secs() {
    var s = SF.Player.secretsState;
    if (!s) s = SF.Player.secretsState = { investigated: {}, anomalyDone: false, found: 0 };
    if (!s.anomalies2Done) s.anomalies2Done = {};
    if (!s.dungeon) s.dungeon = { room: 0, bossSpawned: false, cleared: false, hint: false };
    if (!s.wing) s.wing = { room: 0, cleared: false }; // dungeon-depths-2: sanctum wing, runtime default, save-neutral
    if (typeof s.lifepodSeen === 'undefined') s.lifepodSeen = false;
    if (typeof s.lifepodDone === 'undefined') s.lifepodDone = false;
    if (typeof s.completionist === 'undefined') s.completionist = false;
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
    if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
  }

  function grantWeapon(id) {
    SF.Player.addWeapon(id);
    var w = SF.WEAPON_BY_ID[id];
    if (SF.HUD && SF.HUD.toast)
      SF.HUD.toast('✦ SECRET WEAPON ACQUIRED: ' + (w ? w.name : id).toUpperCase());
    if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
  }

  function found(n) {
    var s = secs();
    s.found = (s.found || 0) + (n || 1);
  }

  /* voice-wiring-v6: pack-6 dungeon whisper lines (whisper_01..04).
   * Guarded SF.Voice6.say + caption; try/catch so voice can never
   * break the dungeon. Save-neutral, no signature changes. */
  function v6whisper(id) {
    try {
      if (window.SF && SF.Voice6 && SF.Voice6.say) SF.Voice6.say(id);
    } catch (e) { /* voice is best-effort */ }
  }

  function checkCompletionist() {
    var s = secs();
    if (s.completionist) return;
    var derelicts = Object.keys(s.investigated || {}).length >= 4;
    var anoms = Object.keys(s.anomalies2Done || {}).length >= 3;
    if (derelicts && anoms && s.anomalyDone && s.dungeon.cleared && s.lifepodDone) {
      s.completionist = true;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('✦ VOIDWALKER — you found every secret. The void remembers your name.');
      SF.Save.save();
    }
  }

  /* ---------------- anomalies ---------------- */

  function anomaliesHere(systemId) {
    var s = secs();
    return SF.ANOMALIES.filter(function (a) {
      return a.systemId === systemId && !s.anomalies2Done[a.id];
    });
  }

  function rollOutcome(a, forced) {
    var r = (typeof forced === 'number') ? forced : Math.random();
    // 50 / 30 / 20 across the three outcomes, mirroring the Drift anomaly
    return r < 0.50 ? a.outcomes[0] : (r < 0.80 ? a.outcomes[1] : a.outcomes[2]);
  }

  var Secrets2 = {

    nearSecret: function (player, systemId) {
      var best = null;
      function consider(x, y, kind, d) {
        var dx = player.x - x, dy = player.y - y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= PROMPT_R && (!best || dist < best.dist)) best = { kind: kind, d: d, dist: dist };
      }
      anomaliesHere(systemId).forEach(function (a) { consider(a.x, a.y, 'anomaly2', a); });
      var s = secs();
      if (s.lifepodSeen && !s.lifepodDone) {
        var lp = SF.LIFEPOD;
        if (lp.systemId === systemId) consider(lp.x, lp.y, 'lifepod', lp);
      }
      SF.DUNGEONS.forEach(function (dg) {
        if (dg.systemId === systemId && !s.dungeon.cleared)
          consider(dg.x, dg.y, 'dungeon', dg);
      });
      // dungeon-depths-2: the sealed stair, only once the Warden is down
      SF.DUNGEONS.forEach(function (dg) {
        if (dg.systemId === systemId && s.dungeon.cleared && !s.wing.cleared)
          consider(dg.x, dg.y, 'dungeon_wing', dg);
      });
      return best;
    },

    investigate: function (target, forcedRoll) {
      if (!target) return;
      if (target.kind === 'anomaly2') this._anomaly2(target.d, forcedRoll);
      else if (target.kind === 'lifepod') this._lifepod();
      else if (target.kind === 'dungeon') this._dungeon(target.d);
      else if (target.kind === 'dungeon_wing') this._wingEntry(target.d); // dungeon-depths-2
    },

    _anomaly2: function (a, forcedRoll) {
      var self = this;
      SF.Dialogue.open({
        title: '✦ ' + a.name.toUpperCase(),
        text: a.text,
        choices: [{
          label: a.outcomes[0].label,
          run: function () {
            var oc = rollOutcome(a, forcedRoll);
            var s = secs();
            SF.Dialogue.open({
              title: '✦ ' + a.name.toUpperCase(),
              text: oc.text,
              choices: [{
                label: 'Continue',
                run: function () {
                  oc.run();
                  s.anomalies2Done[a.id] = oc.id;
                  found(1);
                  SF.Save.save();
                  checkCompletionist();
                  SF.Dialogue.close();
                }
              }]
            });
          }
        }, {
          label: 'Leave it alone',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    _lifepod: function () {
      var s = secs();
      SF.Dialogue.open({
        title: '🛟 LIFEPOD — UNKNOWN SIGNAL',
        text: 'The pod\u2019s viewport is frosted over, but something moves ' +
              'behind the ice. A voice crackles through — half static, half ' +
              'whisper: \u201C…signal… lost… years… the Lantern kept me… ' +
              'take me with you… I remember how the dark flies…\u201D',
        choices: [{
          label: 'Welcome aboard, Hushed',
          run: function () {
            SF.Companions.grant('hushed');
            s.lifepodDone = true;
            found(1);
            SF.Save.save();
            checkCompletionist();
            SF.Dialogue.close();
          }
        }, {
          label: 'Leave them to the dark',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    /* -------- the Hollow Cathedral: 4-room derelict dungeon -------- */

    _dungeon: function (dg) {
      var s = secs();
      var self = this;
      if (s.dungeon.cleared) {
        SF.Dialogue.open({
          title: '☠ ' + dg.name.toUpperCase(),
          text: 'The Cathedral hangs quiet now, its sanctum dark. The Warden ' +
                'is gone. Whatever else slept here has decided to keep sleeping.',
          choices: [{ label: 'Leave', run: function () { SF.Dialogue.close(); } }]
        });
        return;
      }
      SF.Dialogue.open({
        title: '☠ ' + dg.name.toUpperCase(),
        text: 'A derelict the size of a station, hollowed like a cathedral — ' +
              'ribs of black alloy, a nave open to vacuum, something vast and ' +
              'patient breathing in the dark of the sanctum. Docking clamps ' +
              'still answer. The airlock cycles. It is waiting.',
        choices: [{
          label: 'Board her',
          run: function () { self._room(1); }
        }, {
          label: 'Leave',
          run: function () { SF.Dialogue.close(); }
        }]
      });
    },

    _room: function (n) {
      var self = this, s = secs();
      if (n === 1) {
        s.dungeon.room = 1; found(1); SF.Save.save();
        v6whisper('whisper_01'); /* Hollow Cathedral: the Vestibule */
        self._lockedCache({
          room: 1, cache: 'a sealed crew locker',
          loot: { credits: 1500, ore: 40 }, lootLabel: 'the Vestibule',
          title: '☠ VESTIBULE',
          roomText: 'Prayer-niches line the walls, each holding a dead console and ' +
            'a crew manifest with every name struck through. One niche holds ' +
            'a sealed crew locker, its tumbler lock still turning on dead ' +
            'power. Deeper, the reactor nave hums — wrong, and getting louder.',
          openedText: 'The locker clicks open. The salvage is yours.',
          jammedText: 'The tumbler seizes with a dying whine — JAMMED. ' +
            'Whatever is inside stays inside, and the alarm has the whole ' +
            'deck awake.',
          choices: [
            { label: 'Push deeper → Reactor Nave', run: function () { self._room(2); } },
            { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
          ]
        });
      } else if (n === 2) {
        SF.Player.takeDamage(15);
        if (SF.Enemies && SF.Enemies.spawnPatrol) {
          SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 280, SF.Player.y);
          SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x - 280, SF.Player.y + 120);
        }
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The nave wakes — scavengers in the dark!');
        s.dungeon.room = 2; found(1); SF.Save.save();
        v6whisper('whisper_02'); /* Hollow Cathedral: the Reactor Nave */
        self._lockedCache({
          room: 2, cache: 'a reactor-crew cache',
          loot: { credits: 2500, ore: 70, parts: ['fusion_core'] },
          lootLabel: 'the Reactor Nave',
          title: '☠ REACTOR NAVE',
          roomText: 'The reactor is a cracked sun in a cage, and something has ' +
            'been feeding it bodies. Scavengers boil out of the ductwork — ' +
            'you put them down, and the nave goes quiet again. A reactor-crew ' +
            'cache squats by the cage, its tumbler spinning faster than the ' +
            'one in the vestibule. Past the nave, a reliquary glows gold.',
          openedText: 'The cache springs open — reactor-grade salvage.',
          jammedText: 'The tumbler locks solid — JAMMED. The alarm echoes ' +
            'down the nave, and the dark answers.',
          choices: [
            { label: 'Push deeper → Reliquary', run: function () { self._room(3); } },
            { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
          ]
        });
      } else if (n === 3) {
        s.dungeon.room = 3; found(1); SF.Save.save();
        v6whisper('whisper_03'); /* Hollow Cathedral: the Reliquary */
        self._lockedCache({
          room: 3, cache: 'the reliquary vault',
          weapon: 'solar_requiem',
          loot: { credits: 3000, items: ['gravcore'] },
          lootLabel: 'the Reliquary',
          title: '☠ RELIQUARY',
          roomText: 'On a velvet-dark plinth: a weapon that should not exist. ' +
            'SOLAR REQUIEM — seeker beams that hunt like they hold a ' +
            'grudge. The manifest beside it reads only: \u201CFOR THE ' +
            'ONE WHO WALKS THE VOID.\u201D The plinth sits behind a ' +
            'sanctum-grade tumbler, needle screaming around the dial. ' +
            'Beyond the reliquary, the sanctum door grinds open. Something ' +
            'in there just stood up.',
          openedText: 'The vault sighs open. SOLAR REQUIEM is yours.',
          jammedText: 'The sanctum-grade tumbler fuses shut — JAMMED. The ' +
            'weapon stays on its plinth, and the Cathedral is screaming now.',
          choices: [
            { label: 'Enter the Sanctum', run: function () { self._room(4); } },
            { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
          ]
        });
      } else if (n === 4) {
        var boss = this._wardenAlive();
        if (!boss) {
          var mul = (SF.CONFIG.systems && SF.CONFIG.systems[SF.Game.systemId] &&
                     SF.CONFIG.systems[SF.Game.systemId].enemyMul) || 1;
          boss = SF.Enemies.spawn('gunship', SF.Player.x + 320, SF.Player.y, 4.0 * mul,
                                  { storyOid: WARDEN_OID });
          s.dungeon.bossSpawned = true;
          SF.Save.save();
        }
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('☠ THE WARDEN rises from the sanctum dark!');
        v6whisper('whisper_04'); /* Hollow Cathedral: the Sanctum / Warden */
        SF.Dialogue.open({
          title: '☠ SANCTUM — THE WARDEN',
          text: 'It unfolds from the dark like a closing fist: a gunship ' +
                'grown wrong, plated in cathedral black, its reactor burning ' +
                'the color of the Pale Lantern. It has been the Cathedral\u2019s ' +
                'warden since before your grandfather was born. It does not ' +
                'intend to retire. Kill it, and the dark\u2019s finest weapon ' +
                'is yours.',
          choices: [
            { label: 'FACE THE WARDEN', run: function () { SF.Dialogue.close(); } },
            { label: 'Fall back (it will wait)', run: function () { SF.Dialogue.close(); } }
          ]
        });
      }
    },

    /* Locked loot cache: a rotating-dial tumbler (SF.DungeonHack) gates the
     * room's loot. Purely additive — room flow, ambushes and boss logic are
     * untouched. spec: {room, cache, loot, lootLabel, weapon?, title,
     * roomText, openedText, jammedText, choices}. Save-neutral: the jam flag
     * lives in SF.DungeonHack runtime state, never in the save blob. */
    _lockedCache: function (spec) {
      var H = SF.DungeonHack;
      function roomDialogue(outcome) {
        var text = spec.roomText;
        if (outcome === 'opened') text += ' ' + spec.openedText;
        else if (outcome === 'jammed') text += ' ' + spec.jammedText;
        SF.Dialogue.open({ title: spec.title, text: text, choices: spec.choices });
      }
      if (H.jammed(spec.room)) { roomDialogue('jammed'); return; }
      H.open({
        depth: spec.room, cache: spec.cache, title: spec.title,
        onSuccess: function () {
          if (spec.weapon) grantWeapon(spec.weapon);
          giveLoot(spec.loot, spec.lootLabel);
          roomDialogue('opened');
        },
        onFail: function () {
          H.jam(spec.room);
          roomDialogue('jammed');
        }
      });
    },

    _wardenAlive: function () {
      var list = (SF.Enemies && SF.Enemies.list) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].storyOid === WARDEN_OID && list[i].hp > 0) return list[i];
      }
      return null;
    },

    wardenDown: function () {
      var s = secs();
      if (s.dungeon.cleared) return;
      grantWeapon('event_horizon');
      giveLoot({ credits: 8000, ore: 120, items: ['plasmacoil'] }, 'the Warden\u2019s wreck');
      s.dungeon.cleared = true;
      found(1);
      SF.Save.save();
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('✦ THE WARDEN IS DOWN — the Cathedral is yours.');
      checkCompletionist();
    },

    /* ============================================================
     * dungeon-depths-2: the sanctum wing (post-Warden descent).
     * 3 rooms past the sealed stair: Sanctum Antechamber (depth 5) ->
     * Reliquary (depth 6, two tumbler-locked vaults) -> Choir Loft
     * (depth 7, guaranteed ultra mod). New room templates in the existing
     * generator style; tumbler + alarm defenders reuse the depth scaling.
     * Save-neutral: wing state is a runtime default in secs().
     * ============================================================ */

    _wingEntry: function (dg) {
      var self = this;
      SF.Dialogue.open({
        title: '☠ THE HOLLOW CATHEDRAL — SEALED STAIR',
        text: 'With the Warden dead, the sanctum\u2019s far wall has split ' +
              'along a seam you never noticed: a sealed stair spirals DOWN, ' +
              'past the hull, into dark the Cathedral kept even from its ' +
              'Warden. The air from below smells of ozone and old incense. ' +
              'Three chambers wait below — antechamber, reliquary, choir ' +
              'loft — and the tumblers down there spin faster than anything ' +
              'you have cracked so far.',
        choices: [
          { label: 'Descend the sealed stair', run: function () { v6whisper('whisper_01'); self._wing(1); } },
          { label: 'Not yet', run: function () { SF.Dialogue.close(); } }
        ]
      });
    },

    _wing: function (n) {
      var self = this, s = secs();
      if (s.wing.cleared) {
        SF.Dialogue.open({
          title: '☠ SANCTUM WING',
          text: 'The wing is silent now, every vault cracked or jammed for ' +
                'good. The Cathedral keeps nothing from you anymore.',
          choices: [{ label: 'Leave', run: function () { SF.Dialogue.close(); } }]
        });
        return;
      }
      if (n === 1) {
        SF.Player.takeDamage(20);
        if (SF.Enemies && SF.Enemies.spawnPatrol) {
          SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x + 300, SF.Player.y);
          SF.Enemies.spawnPatrol(SF.Game.systemId, SF.Player.x - 300, SF.Player.y + 140);
        }
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The antechamber wakes — wardens of the deep!');
        s.wing.room = 1; found(1); SF.Save.save();
        v6whisper('whisper_02'); /* Sanctum wing: the Antechamber */
        self._wingCache({
          jamKey: 'w1', depth: 5, cache: 'a warden\u2019s footlocker',
          loot: { credits: 4000, ore: 90, parts: ['fusion_core'] },
          lootLabel: 'the Sanctum Antechamber',
          title: '☠ SANCTUM ANTECHAMBER',
          roomText: 'A mustering hall for things that were never crew. ' +
            'Wardens of the deep boil out of the dark — older than the ' +
            'Warden, slower, meaner — and you put them down in the ' +
            'flickering dark. A warden\u2019s footlocker squats by the ' +
            'stairwell, its tumbler already screaming at depth five. ' +
            'Past it, reliquary gold glints through the gloom.',
          openedText: 'The footlocker cracks open — deep-wreck salvage.',
          jammedText: 'The deep tumbler fuses solid — JAMMED. The alarm ' +
            'rolls down the stairwell, and the dark is full of engines.',
          choices: [
            { label: 'Push deeper → Reliquary', run: function () { self._wing(2); } },
            { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
          ]
        });
      } else if (n === 2) {
        s.wing.room = 2; found(1); SF.Save.save();
        v6whisper('whisper_03'); /* Sanctum wing: the Reliquary */
        self._wingReliquary();
      } else if (n === 3) {
        s.wing.room = 3; found(1); SF.Save.save();
        v6whisper('whisper_04'); /* Sanctum wing: the Choir Loft */
        self._wingCache({
          jamKey: 'w3', depth: 7, cache: 'the choir vault',
          mod: 'requiem_harmonics',
          title: '☠ CHOIR LOFT',
          roomText: 'The loft is a throat of black glass, and it is ' +
            'singing — the same song the Choir of Glass sang, but older, ' +
            'from inside the Cathedral\u2019s own bones. At the conductor\u2019s ' +
            'lectern waits a single vault, depth seven, the needle a blur. ' +
            'Inside: the Warden\u2019s private tuning, REQUIEM HARMONICS — ' +
            'the finest weapon mod in the dark. Crack it, and the wing ' +
            'is yours.',
          openedText: 'The choir vault sighs open. REQUIEM HARMONICS is yours.',
          jammedText: 'The depth-seven tumbler welds itself shut — JAMMED. ' +
            'The song stops. The dark is listening.',
          onOpened: function () {
            s.wing.cleared = true;
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('✦ THE SANCTUM WING IS SILENT — the Cathedral keeps nothing from you now.');
          },
          choices: [
            { label: 'Ascend, rich and alive', run: function () { SF.Dialogue.close(); } }
          ]
        });
      }
    },

    _wingReliquary: function () {
      var self = this;
      self._wingCache({
        jamKey: 'w2a', depth: 6, cache: 'the first reliquary vault',
        loot: { credits: 5000, items: ['gravcore'] },
        lootLabel: 'the first reliquary vault',
        title: '☠ RELIQUARY — FIRST VAULT',
        roomText: 'Gold on black velvet, row after row: the Cathedral\u2019s ' +
          'tithe to whatever it worshipped. Two vaults dominate the row, ' +
          'both on depth-six tumblers. The first one is already turning.',
        openedText: 'The first vault springs open — tithe-grade salvage.',
        jammedText: 'The first vault\u2019s tumbler fuses — JAMMED. The ' +
          'second vault keeps turning, unbothered.',
        choices: [
          { label: 'Crack the second vault', run: function () { self._wingSecondVault(); } },
          { label: 'Ascend → Choir Loft', run: function () { self._wing(3); } },
          { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
        ]
      });
    },

    _wingSecondVault: function () {
      var self = this;
      self._wingCache({
        jamKey: 'w2b', depth: 6, cache: 'the second reliquary vault',
        loot: { ore: 60, parts: ['ion_thruster'] },
        lootLabel: 'the second reliquary vault',
        title: '☠ RELIQUARY — SECOND VAULT',
        roomText: 'The second vault turns with the patience of something ' +
          'that has outwaited empires. Same depth, same scream of the ' +
          'needle — but the manifest drawer is already open, like it was ' +
          'expecting you.',
        openedText: 'The second vault yields its tithe.',
        jammedText: 'The second vault\u2019s tumbler fuses — JAMMED. The ' +
          'reliquary dims, but the choir loft above keeps singing.',
        choices: [
          { label: 'Ascend → Choir Loft', run: function () { self._wing(3); } },
          { label: 'Withdraw', run: function () { SF.Dialogue.close(); } }
        ]
      });
    },

    /* Wing twin of _lockedCache: same tumbler-lock gating, but the jam key
     * is a wing-scoped string (no collision with rooms 1-4), the depth is
     * passed through (5-7), and it can grant a weapon mod instead of /
     * alongside plain loot. Save-neutral: jam flags stay runtime-only. */
    _wingCache: function (spec) {
      var H = SF.DungeonHack;
      function wingDialogue(outcome) {
        var text = spec.roomText;
        if (outcome === 'opened') text += ' ' + spec.openedText;
        else if (outcome === 'jammed') text += ' ' + spec.jammedText;
        SF.Dialogue.open({ title: spec.title, text: text, choices: spec.choices });
      }
      if (H.jammed(spec.jamKey)) { wingDialogue('jammed'); return; }
      H.open({
        depth: spec.depth, cache: spec.cache, title: spec.title,
        onSuccess: function () {
          if (spec.mod) {
            if (SF.Mods && SF.Mods.addMod) SF.Mods.addMod(spec.mod);
            var m = SF.MOD_BY_ID[spec.mod];
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('✦ ULTRA MOD ACQUIRED: ' + (m ? m.name : spec.mod).toUpperCase());
            if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
          }
          if (spec.loot) giveLoot(spec.loot, spec.lootLabel);
          if (spec.onOpened) spec.onOpened();
          SF.Save.save();
          wingDialogue('opened');
        },
        onFail: function () {
          H.jam(spec.jamKey);
          wingDialogue('jammed');
        }
      });
    },

    /* ---------------- drawing ---------------- */

    draw: function (ctx, systemId, time) {
      var self = this, s = secs();
      SF.ANOMALIES.forEach(function (a) {
        if (a.systemId !== systemId || s.anomalies2Done[a.id]) return;
        var pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
        ctx.save();
        ctx.translate(a.x, a.y);
        if (a.id === 'weeping_bell') {
          // bell: arcs + falling light
          ctx.strokeStyle = a.color; ctx.lineWidth = 2;
          ctx.globalAlpha = 0.55 + 0.35 * pulse;
          ctx.beginPath(); ctx.arc(0, 4, 20 + pulse * 8, Math.PI, 0); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 4, 30 + pulse * 8, Math.PI, 0); ctx.stroke();
          ctx.fillStyle = a.color;
          ctx.beginPath(); ctx.arc(0, 6 + pulse * 6, 3, 0, Math.PI * 2); ctx.fill();
        } else if (a.id === 'choir_glass') {
          // glass: rotating shard ring
          ctx.strokeStyle = a.color; ctx.lineWidth = 1.6;
          ctx.globalAlpha = 0.6 + 0.3 * pulse;
          for (var i = 0; i < 6; i++) {
            var an = time * 0.4 + i * Math.PI / 3;
            var r0 = 16 + pulse * 5, r1 = 30 + pulse * 5;
            ctx.beginPath();
            ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
            ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
            ctx.stroke();
          }
        } else {
          // pale lantern: steady cold flame
          var g = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
          g.addColorStop(0, 'rgba(184,255,201,0.9)');
          g.addColorStop(1, 'rgba(184,255,201,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#eafff0';
          ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.fillStyle = a.color;
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('✦ ' + a.name.toUpperCase(), a.x, a.y - 52);
      });
      // lifepod (only while the ghost signal is active)
      if (s.lifepodSeen && !s.lifepodDone && SF.LIFEPOD.systemId === systemId) {
        var lp = SF.LIFEPOD;
        ctx.save();
        ctx.translate(lp.x, lp.y); ctx.rotate(-0.4);
        ctx.fillStyle = '#3a4152';
        ctx.beginPath(); ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#9aa3b8'; ctx.lineWidth = 1.5; ctx.stroke();
        var blink = (Math.floor(time * 2) % 2 === 0);
        ctx.fillStyle = blink ? '#ff5f6e' : '#3a1015';
        ctx.beginPath(); ctx.arc(10, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ff8f9a';
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('🛟 LIFEPOD', lp.x, lp.y - 30);
      }
      // the Hollow Cathedral: a station-sized hollowed derelict
      SF.DUNGEONS.forEach(function (dg) {
        if (dg.systemId !== systemId || s.dungeon.cleared) return;
        var pl = 0.5 + 0.5 * Math.sin(time * 1.2);
        ctx.save();
        ctx.translate(dg.x, dg.y);
        // violet hollow glow
        var gg = ctx.createRadialGradient(0, 0, 10, 0, 0, 90);
        gg.addColorStop(0, 'rgba(140,80,255,' + (0.25 + 0.15 * pl).toFixed(2) + ')');
        gg.addColorStop(1, 'rgba(140,80,255,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fill();
        // three broken ribs
        ctx.strokeStyle = '#4a4260'; ctx.lineWidth = 5;
        [[-46, -20, 0.5], [0, 30, -0.3], [46, -18, 0.9]].forEach(function (r) {
          ctx.save(); ctx.translate(r[0], r[1]); ctx.rotate(r[2]);
          ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.stroke();
          ctx.restore();
        });
        // sanctum ember
        ctx.fillStyle = 'rgba(184,255,201,' + (0.5 + 0.5 * pl).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(0, 0, 5 + pl * 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#b48cff';
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        ctx.fillText('☠ THE HOLLOW CATHEDRAL', dg.x, dg.y - 104);
        if (s.dungeon.hint) {
          ctx.fillStyle = '#8a7ab8';
          ctx.font = '11px monospace';
          ctx.fillText('(the Choir\u2019s coordinates)', dg.x, dg.y + 118);
        }
      });
      // dungeon-depths-2: the sealed stair — once the Warden is down and the
      // wing is unrun, mark the descent point with a pulsing gold ring.
      SF.DUNGEONS.forEach(function (dg) {
        if (dg.systemId !== systemId || !s.dungeon.cleared || s.wing.cleared) return;
        var wp = 0.5 + 0.5 * Math.sin(time * 2.0);
        ctx.save();
        ctx.translate(dg.x, dg.y);
        ctx.strokeStyle = 'rgba(255,210,74,' + (0.45 + 0.35 * wp).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('▼ SEALED STAIR — SANCTUM WING', dg.x, dg.y + 134);
      });
    }
  };

  SF.Secrets2 = Secrets2;

  /* ============================================================
   * dungeon-hack-minigame phase: SF.DungeonHack
   *
   * Rotating-dial tumbler lock for the Hollow Cathedral loot caches.
   * The needle sweeps the dial; tap STOP (or Space) while it is inside
   * the green arc to set each of 3 pins. A missed pin fires the alarm
   * (SF.Audio 'alert' + 'deny') and spawns a wave of dungeon defenders.
   * 3 set pins -> the cache opens (onSuccess). 3 missed pins -> the
   * tumbler jams for this dungeon run (onFail).
   *
   * Difficulty scales with dungeon depth (room number): the needle gets
   * faster and the green arc narrower the deeper you go.
   *
   * Purely additive: self-driven DOM overlay + its own rAF loop, no hooks
   * into main.js, no CSS files touched (inline styles only). Save-neutral:
   * jam flags are runtime-only, never written to the save blob, no
   * SF.SAVE_VERSION bump.
   * ============================================================ */
  SF.DungeonHack = (function () {
    var OVERLAY_ID = 'sf-hack-overlay';
    var PINS = 3;

    var jammedRooms = {}; // room -> true; runtime only, never saved
    var active = null;    // current session or null

    function difficultyFor(depth) {
      // dungeon-depths-2: clamp extended 4 -> 7 for the sanctum wing depths
      // 5-7; depths 1-4 produce exactly the same values as before.
      var d = Math.max(1, Math.min(7, (depth | 0) || 1));
      return {
        depth: d,
        speed: 2.0 + 1.15 * d,               // needle rad/s
        arc: Math.max(0.26, 0.66 - 0.12 * d) // green arc width, rad
      };
    }

    function angDiff(a, b) { // signed diff a-b in [-PI, PI]
      var d = (a - b) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    function spawnDefenders(depth) {
      if (!(SF.Enemies && SF.Enemies.spawnPatrol) || !SF.Player || !SF.Game) return 0;
      var n = 1 + Math.min(3, depth);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, d = 420 + Math.random() * 160;
        try {
          SF.Enemies.spawnPatrol(SF.Game.systemId,
            SF.Player.x + Math.cos(a) * d, SF.Player.y + Math.sin(a) * d);
        } catch (e) { /* never break the minigame on a spawn hiccup */ }
      }
      return n;
    }

    function sfx(id) {
      try { if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx(id); } catch (e) {}
    }
    function toast(msg) {
      try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
    }

    function el(tag, parent, style, text) {
      var e = document.createElement(tag);
      if (style) for (var k in style) e.style[k] = style[k];
      if (text) e.textContent = text;
      if (parent) parent.appendChild(e);
      return e;
    }

    function buildOverlay() {
      var ov = document.getElementById(OVERLAY_ID);
      if (ov) ov.parentNode.removeChild(ov);
      ov = el('div', document.body, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        background: 'rgba(4,6,12,0.82)', zIndex: '9999',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'monospace', userSelect: 'none', touchAction: 'manipulation'
      });
      ov.id = OVERLAY_ID;
      var panel = el('div', ov, {
        background: '#0d1220', border: '2px solid #b48cff', borderRadius: '12px',
        padding: '18px 22px', textAlign: 'center', maxWidth: '92vw'
      });
      var title = el('div', panel, {
        color: '#b48cff', fontSize: '17px', fontWeight: 'bold',
        letterSpacing: '1px', marginBottom: '6px'
      });
      var status = el('div', panel, {
        color: '#9aa3b8', fontSize: '13px', marginBottom: '8px', minHeight: '18px'
      });
      var cv = el('canvas', panel, { width: '340px', height: '300px', display: 'block', margin: '0 auto' });
      cv.width = 340; cv.height = 300;
      cv.id = 'sf-hack-dial';
      var stop = el('button', panel, {
        marginTop: '10px', padding: '14px 34px', fontSize: '18px',
        fontFamily: 'monospace', fontWeight: 'bold', color: '#06130a',
        background: '#39ff7a', border: 'none', borderRadius: '10px', cursor: 'pointer'
      }, '⏺ STOP THE NEEDLE');
      stop.id = 'sf-hack-stop';
      var hint = el('div', panel, {
        color: '#5a6478', fontSize: '11px', marginTop: '8px'
      });
      return { ov: ov, title: title, status: status, cv: cv, stop: stop, hint: hint };
    }

    function draw(sess) {
      var ctx = sess.ctx, W = 340, H = 300, cx = W / 2, cy = H / 2 - 8, R = 118;
      ctx.clearRect(0, 0, W, H);
      if (sess.flash > 0) {
        ctx.fillStyle = 'rgba(255,45,45,' + (0.30 * sess.flash).toFixed(2) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      // dial face
      ctx.fillStyle = '#0a0e18';
      ctx.beginPath(); ctx.arc(cx, cy, R + 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a4356'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R + 18, 0, Math.PI * 2); ctx.stroke();
      // tick marks
      ctx.strokeStyle = '#556074'; ctx.lineWidth = 1.5;
      for (var i = 0; i < 24; i++) {
        var ta = i * Math.PI / 12;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ta) * (R + 8), cy + Math.sin(ta) * (R + 8));
        ctx.lineTo(cx + Math.cos(ta) * (R + 14), cy + Math.sin(ta) * (R + 14));
        ctx.stroke();
      }
      // green arc (target zone)
      var a0 = sess.arcCenter - sess.arc / 2, a1 = sess.arcCenter + sess.arc / 2;
      ctx.save();
      ctx.strokeStyle = '#39ff7a'; ctx.lineWidth = 13;
      ctx.shadowColor = '#39ff7a'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
      ctx.restore();
      // needle
      var nx = cx + Math.cos(sess.angle) * (R - 6), ny = cy + Math.sin(sess.angle) * (R - 6);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(nx, ny, 6, 0, Math.PI * 2); ctx.fill();
      // hub
      ctx.fillStyle = '#b48cff';
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d1220';
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      // pin pips
      for (var p = 0; p < PINS; p++) {
        var px = cx + (p - (PINS - 1) / 2) * 34, py = H - 22;
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2);
        if (p < sess.pinsSet) { ctx.fillStyle = '#39ff7a'; ctx.fill(); }
        else if (p < sess.pinsSet + sess.pinsFailed) { ctx.fillStyle = '#ff3b30'; ctx.fill(); }
        else { ctx.strokeStyle = '#556074'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.fillStyle = '#9aa3b8'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('DEPTH ' + sess.diff.depth + ' — needle ' +
        sess.diff.speed.toFixed(1) + ' rad/s', cx, 16);
    }

    function setStatus(sess, html, color) {
      sess.ui.status.textContent = html;
      sess.ui.status.style.color = color || '#9aa3b8';
    }

    function attempt() {
      var sess = active;
      if (!sess || sess.done) return;
      var d = Math.abs(angDiff(sess.angle, sess.arcCenter));
      if (d <= sess.arc / 2) {
        // pin set
        sess.pinsSet++;
        sfx('hack_success');
        sess.diff.speed += 0.35; // the tumbler fights back
        sess.arcCenter = Math.random() * Math.PI * 2;
        if (sess.pinsSet >= PINS) { resolve(true); return; }
        setStatus(sess, 'PIN ' + sess.pinsSet + '/' + PINS + ' SET — ' +
          (PINS - sess.pinsSet) + ' to go. It spins faster now…', '#39ff7a');
      } else {
        // missed pin: alarm + defenders
        sess.pinsFailed++;
        sess.flash = 1;
        sfx('hack_fail'); sfx('alert');
        var n = spawnDefenders(sess.diff.depth);
        toast('🚨 TUMBLER ALARM — ' + n + ' dungeon defender' +
          (n === 1 ? '' : 's') + ' inbound!');
        if (sess.pinsFailed >= PINS) { resolve(false); return; }
        setStatus(sess, 'MISS — alarm ping (' + sess.pinsFailed + '/' + PINS +
          '). Defenders are coming. Steady…', '#ff5f6e');
      }
    }

    function resolve(ok) {
      var sess = active;
      if (!sess || sess.done) return;
      sess.done = true;
      teardown(sess);
      if (ok) { sfx('pickup'); toast('🔓 Tumbler beaten — the cache opens.'); }
      else { sfx('hack_fail'); toast('⛔ The tumbler JAMS. The cache stays sealed.'); }
      try { (ok ? sess.onSuccess : sess.onFail)(); } catch (e) {}
      active = null;
    }

    function teardown(sess) {
      if (sess.raf) cancelAnimationFrame(sess.raf);
      window.removeEventListener('keydown', sess.onKey, true);
      if (sess.ui && sess.ui.ov && sess.ui.ov.parentNode)
        sess.ui.ov.parentNode.removeChild(sess.ui.ov);
    }

    function open(opts) {
      if (active) return; // one tumbler at a time
      var diff = difficultyFor(opts.depth);
      var ui = buildOverlay();
      ui.title.textContent = '🔓 TUMBLER LOCK — ' + (opts.cache || 'sealed cache').toUpperCase();
      ui.hint.textContent = (opts.title || '') + ' · depth ' + diff.depth +
        ' · 3 pins · miss a pin and the alarm brings defenders';
      var sess = {
        ui: ui, ctx: ui.cv.getContext('2d'), diff: diff,
        angle: Math.random() * Math.PI * 2,
        arc: diff.arc, arcCenter: Math.random() * Math.PI * 2,
        pinsSet: 0, pinsFailed: 0, flash: 0, done: false,
        last: performance.now(), raf: 0,
        onSuccess: opts.onSuccess, onFail: opts.onFail,
        onKey: function (e) {
          if (e.code === 'Space' || e.code === 'Enter') {
            e.preventDefault(); e.stopPropagation(); attempt();
          }
        }
      };
      active = sess;
      ui.ov.addEventListener('pointerdown', function () { attempt(); });
      window.addEventListener('keydown', sess.onKey, true);
      sfx('ui'); // tumbler engages (banked ui.ogg; router falls back to synth)
      setStatus(sess, 'Stop the needle inside the GREEN ARC — ' + PINS + ' pins to crack it.');
      function frame(t) {
        if (!active || sess.done) return;
        var dt = Math.min(0.05, (t - sess.last) / 1000);
        sess.last = t;
        sess.angle = (sess.angle + sess.diff.speed * dt) % (Math.PI * 2);
        if (sess.flash > 0) sess.flash = Math.max(0, sess.flash - dt * 2.2);
        draw(sess);
        sess.raf = requestAnimationFrame(frame);
      }
      sess.raf = requestAnimationFrame(frame);
    }

    return {
      difficultyFor: difficultyFor,
      jammed: function (room) { return !!jammedRooms[room]; },
      jam: function (room) { jammedRooms[room] = true; },
      open: open,
      isOpen: function () { return !!active; },
      // test hook: live session telemetry for the smoke test
      debug: function () {
        if (!active) return null;
        return {
          depth: active.diff.depth, speed: active.diff.speed, arc: active.arc,
          angDiff: angDiff(active.angle, active.arcCenter),
          pinsSet: active.pinsSet, pinsFailed: active.pinsFailed
        };
      }
    };
  })();

  /* ============================================================
   * dungeon-depths-2: ultra weapon mod for the choir loft.
   * Gold tier, secretOnly (granted only by the wing — never sold,
   * dropped or crafted). Registered additively after data.js, same
   * pattern as the HQ-exclusive mod push there.
   * ============================================================ */
  SF.MODS.push({
    id: 'requiem_harmonics', name: 'Requiem Harmonics', tier: 'gold', price: 0,
    secretOnly: true,
    mul: { dmg: 1.5, rate: 1.2, range: 1.15 }, color: '#ffd24a',
    desc: 'CHOIR LOFT ONLY. The Warden\u2019s private tuning: +50% damage, +20% fire rate, +15% range.'
  });
  SF.MOD_BY_ID.requiem_harmonics = SF.MODS[SF.MODS.length - 1];

  /* ---------------- integration: wrap SF.Secrets + SF.Enemies ---------------- */

  var origNear = SF.Secrets.nearSecret.bind(SF.Secrets);
  SF.Secrets.nearSecret = function (player, systemId) {
    var a = origNear(player, systemId);
    var b = Secrets2.nearSecret(player, systemId);
    if (a && b) return (a.dist <= b.dist) ? a : b;
    return a || b;
  };

  var origInvestigate = SF.Secrets.investigate.bind(SF.Secrets);
  SF.Secrets.investigate = function (target, forcedRoll) {
    if (!target) return;
    if (target.kind === 'derelict' || target.kind === 'anomaly')
      return origInvestigate(target);
    return Secrets2.investigate(target, forcedRoll);
  };

  var origDraw = SF.Secrets.draw.bind(SF.Secrets);
  SF.Secrets.draw = function (ctx, systemId, time) {
    origDraw(ctx, systemId, time);
    Secrets2.draw(ctx, systemId, time);
  };

  var origKill = SF.Enemies.kill.bind(SF.Enemies);
  SF.Enemies.kill = function (e) {
    var isWarden = !!(e && e.storyOid === WARDEN_OID);
    origKill.call(SF.Enemies, e);
    if (isWarden) Secrets2.wardenDown();
  };

})();

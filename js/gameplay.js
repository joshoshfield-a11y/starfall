/* ============================================================
 * STARFALL — gameplay-depth: random encounters v2 + bounty board
 *
 * SF.Encounters: weighted per-system encounter tables replacing the raw
 * patrol timer in main.js. Encounter kinds: patrol (existing spawnPatrol),
 * ambush (pirate pack with an escalation reinforcement wave), convoy
 * (neutral faction traders — attackable, with standing consequences),
 * distress (adrift ship, 50% pirate trap), minefield (hostile mines).
 * Difficulty scaling (Solace < Drift < Ember) via SF.CONFIG.difficulty.
 *
 * SF.Bounty: procedurally generated named bounties. Offers re-rolled each
 * dock, claimed at the quest board section of any station. The target is a
 * named elite enemy spawned in its home system (waypoint + HUD ping);
 * killing it lets you turn the bounty in at any station for credits plus
 * faction standing consequences (sponsor up, target's faction down on
 * renegade bounties). State persists on the player blob (bounties), save v9.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function pickW(table) {
    var total = 0, i;
    for (i = 0; i < table.length; i++) total += table[i][1];
    var r = Math.random() * total;
    for (i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return table[i][0];
    }
    return table[0][0];
  }
  function toast(msg) { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }

  var SYSTEM_FACTION = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  function diffOf(sysId) {
    return (SF.CONFIG.difficulty && SF.CONFIG.difficulty[sysId]) ||
      { label: 'CALM', budget: 1.0, dmgMul: 1.0, fireMul: 1.0 };
  }

  function spawnNear(typeId, mul, opts, minD, maxD) {
    var p = SF.Player, cfg = SF.CONFIG;
    var a = Math.random() * Math.PI * 2;
    var d = (minD || 600) + Math.random() * ((maxD || 950) - (minD || 600));
    var x = p.x + Math.cos(a) * d;
    var y = p.y + Math.sin(a) * d;
    return SF.Enemies.spawn(typeId, x, y, mul, opts || {});
  }

  /* ============================ ENCOUNTERS v2 ============================ */

  var encounterTimer = 6;
  var escalation = null; // { t, sys } reinforcement countdown for ambushes

  var Encounters = {

    /* called on system entry (resets the encounter clock) */
    reset: function () {
      encounterTimer = 5 + Math.random() * 5;
      escalation = null;
    },

    tick: function (dt) {
      var p = SF.Player, sysId = SF.Game.systemId;
      var diff = diffOf(sysId);

      // ambush escalation: reinforcements inbound unless the pack is wiped first
      if (escalation) {
        var alive = SF.Enemies.list.some(function (e) { return e.encounter === 'ambush'; });
        if (!alive) {
          escalation = null; // pack wiped before backup arrived
        } else {
          escalation.t -= dt;
          if (escalation.t <= 0) {
            var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
            var n = rint(1, 2);
            // early-game-difficulty-1: rookie escalation brings raiders,
            // not gunships (16dmg homing bolts vs a starter hull is the
            // reported early-death spike). Identity outside the window.
            var escType = (SF.Enemies.rookieFactor &&
              SF.Enemies.rookieFactor(sysId).active) ? 'raider' : 'gunship';
            for (var i = 0; i < n; i++) spawnNear(escType, mul * 1.1, { encounter: 'ambush' }, 550, 850);
            toast('⚠ Enemy reinforcements inbound!');
            escalation = null;
          }
        }
      }

      // bounty target spawn check
      if (window.SF && SF.Bounty) SF.Bounty.spawnCheck();

      encounterTimer -= dt;
      if (encounterTimer > 0) return;
      var base = SF.CONFIG.patrolInterval;
      // beta2-pressure-tutorial: Solace breather. The CALM starter
      // system rolls its next encounter ~2.5x slower (20–35s instead
      // of 8–14s), so exploring Solace has quiet windows between
      // contacts. Drift/Ember pacing is untouched (their budget
      // division still applies, pace stays 1 there). Rookie factors,
      // cap, and encounter tables are unchanged. (1.8x was tried
      // first with the tuned leash: 2 deaths / 147 hull damage per
      // 150s stop-start probe, vs 3 / 337 pre-fix. 2.5x is the trial
      // to see whether arrivals during stops drop further — see
      // phase REPORT for the verdict before this ships.)
      var pace = sysId === 'solace' ? 2.5 : 1;
      encounterTimer = (base[0] + Math.random() * (base[1] - base[0])) / diff.budget * pace;
      if (SF.Enemies.list.length >= SF.CONFIG.patrolCap * diff.budget) return;
      var kind = pickW(SF.CONFIG.encounters[sysId] || SF.CONFIG.encounters.solace);
      this.run(kind);
    },

    /* run one encounter now (kind may be forced by tests). */
    run: function (kind) {      var sysId = SF.Game.systemId, p = SF.Player;
      var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
      var diff = diffOf(sysId);
      // early-game-difficulty-1: a rookie in Solace never eats a scripted
      // ambush (3-4 hulls + gunship escalation). Downgrade to a normal
      // patrol roll — same sky traffic, survivable teeth (spawn() also
      // applies the rookie damage/fire scaling to whatever shows up).
      if (kind === 'ambush' && SF.Enemies.rookieFactor &&
          SF.Enemies.rookieFactor(sysId).active) kind = 'patrol';
      switch (kind) {
        case 'ambush': {
          var n = Math.max(2, Math.round(rint(3, 4) * diff.budget / 1.4));
          for (var i = 0; i < n; i++) {
            var t = Math.random() < 0.3 ? 'gunship' : 'raider';
            spawnNear(t, mul, { encounter: 'ambush' }, 550, 900);
          }
          escalation = { t: 22, sys: sysId };
          toast('⚠ Pirate ambush! Hostiles on all scopes!');
          break;
        }
        case 'convoy': {
          // neutral faction traders crossing the lane — leave them be, or don't
          var f = SYSTEM_FACTION[sysId];
          var m = Math.max(2, Math.round(3 * diff.budget / 1.4));
          for (var j = 0; j < m; j++) {
            var e = spawnNear(j === 0 ? 'gunship' : 'raider', mul, { faction: f, trader: true }, 600, 900);
            if (e) {
              var a = Math.random() * Math.PI * 2;
              e.vx = Math.cos(a) * 60; e.vy = Math.sin(a) * 60;
            }
          }
          var fd = f && SF.FACTION_BY_ID[f];
          toast(fd ? 'Trader convoy passing — ' + fd.name + ' freighters. Fire at your own risk.'
                   : 'Trader convoy passing. Fire at your own risk.');
          break;
        }
        case 'distress': {
          var trap = Math.random() < 0.5;
          var w = spawnNear('raider', mul, { encounter: 'distress', distressTrap: trap }, 500, 750);
          if (w) { w.adrift = true; w.crew = Math.max(w.crew, 2); }
          toast('🆘 Distress beacon! Someone\'s adrift out there.');
          break;
        }
        case 'minefield': {
          var mn = Math.max(4, Math.round(7 * diff.budget / 1.4));
          for (var k = 0; k < mn; k++) {
            var a2 = Math.random() * Math.PI * 2, d2 = 300 + Math.random() * 500;
            var x = p.x + Math.cos(a2) * d2;
            var y = p.y + Math.sin(a2) * d2;
            // hostile mines: proximity-detonate on the player (collisions branch)
            SF.Projectiles.spawn(x, y, 0, 0, Math.round(30 * diff.dmgMul), false,
              '#ff5e3a', { mine: true, blast: 110, life: 75, radius: 6 });
          }
          toast('⚠ Minefield! Old war ordnance — steer clear.');
          break;
        }
        case 'patrol':
        default:
          SF.Enemies.spawnPatrol(sysId, p.x, p.y);
          break;
      }
    },

    // test hook: escalation countdown state
    testState: function () { return { timer: encounterTimer, escalation: escalation }; },
    // test hook: hold the encounter timer (deterministic smoke tests)
    testHold: function (t) { encounterTimer = t; }
  };

  SF.Encounters = Encounters;

  /* ============================ BOUNTY BOARD ============================ */

  function bs() { return SF.Player.bountyState; }

  function rollBounty() {
    var cfg = SF.CONFIG.bounty;
    var sysKeys = ['solace', 'drift', 'ember'];
    var sys = sysKeys[rint(0, 2)];
    var cls = Math.random() < 0.55 ? 'raider' : 'gunship';
    var rng = cfg.reward[cls];
    var reward = Math.round((rng[0] + Math.random() * (rng[1] - rng[0])) * cfg.dangerMul[sys]);
    var name = SF.BOUNTY_FIRST[rint(0, SF.BOUNTY_FIRST.length - 1)] + ' ' +
      SF.BOUNTY_LAST[rint(0, SF.BOUNTY_LAST.length - 1)];
    if (Math.random() < 0.3) name += ' ' + SF.BOUNTY_TITLES[rint(0, SF.BOUNTY_TITLES.length - 1)];
    var sponsors = ['compact', 'drifters', 'ember'];
    var sponsor = sponsors[rint(0, 2)];
    // 30%: renegade of a faction — killing them angers that faction
    var renegade = Math.random() < 0.3 ? sponsors[rint(0, 2)] : null;
    return {
      id: 'b' + Date.now().toString(36) + rint(100, 999),
      name: name, shipClass: cls, system: sys, reward: reward,
      sponsor: sponsor, renegade: renegade,
      state: 'offer'
    };
  }

  var Bounty = {

    /* re-rolled each dock */
    rollOffers: function () {
      var st = bs();
      st.offers = [];
      for (var i = 0; i < 3; i++) st.offers.push(rollBounty());
    },

    offers: function () { return bs().offers || []; },
    active: function () { return bs().active; },

    accept: function (offerId) {
      var st = bs();
      if (st.active) { toast('Finish your current bounty first.'); return false; }
      var i = st.offers.findIndex(function (o) { return o.id === offerId; });
      if (i < 0) return false;
      var b = st.offers.splice(i, 1)[0];
      b.state = 'active';
      b.spawned = false;
      st.active = b;
      // waypoint to the target's home system (hud.js draws it on-system)
      SF.Game.waypoint = { systemId: b.system, x: 2100, y: 2100,
        label: '☠ ' + b.name };
      toast('Bounty accepted: ' + b.name + ' — last seen in ' +
        SF.SYSTEM_BY_ID[b.system].name + '.');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      return true;
    },

    /* spawn the named target when the player is in its system */
    spawnCheck: function () {
      var st = bs(), b = st.active;
      if (!b || b.state !== 'active' || b.spawned) return;
      if (SF.Game.systemId !== b.system) return;
      var already = SF.Enemies.list.some(function (e) { return e.bountyId === b.id; });
      if (already) { b.spawned = true; return; }
      var mul = (SF.SYSTEM_BY_ID[b.system] ? SF.SYSTEM_BY_ID[b.system].enemyMul : 1) *
        SF.CONFIG.bounty.eliteHpMul;
      var e = spawnNear(b.shipClass, mul,
        { bountyId: b.id, bountyName: b.name }, 600, 850);
      if (e) {
        b.spawned = true;
        toast('☠ Wanted: ' + b.name + ' detected on scope!');
      }
    },

    /* called from SF.Enemies.kill */
    onKill: function (e) {
      var st = bs(), b = st.active;
      if (b && b.state === 'active' && e.bountyId === b.id) {
        b.state = 'ready';
        toast('☠ Bounty target down! Collect at any station.');
        if (SF.Game.waypoint) SF.Game.waypoint = null;
        if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      }
    },

    turnIn: function () {
      var st = bs(), b = st.active;
      if (!b || b.state !== 'ready') return false;
      var cfg = SF.CONFIG.bounty;
      SF.Player.credits += b.reward;
      if (SF.Factions) {
        SF.Factions.shift(b.sponsor, cfg.sponsorBonus);
        if (b.renegade) SF.Factions.shift(b.renegade, -cfg.renegadePenalty);
        SF.Factions.shiftKarma(cfg.karmaBonus);
      }
      st.active = null;
      st.done = (st.done || 0) + 1;
      toast('✔ Bounty paid: +' + b.reward + 'cr' +
        (SF.Factions ? ', ' + SF.FACTION_BY_ID[b.sponsor].name + ' +' + cfg.sponsorBonus +
          (b.renegade ? ', ' + SF.FACTION_BY_ID[b.renegade].name + ' -' + cfg.renegadePenalty : '') : ''));
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      // planets-facilities: bounty claims make the wire
      if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 Bounty claimed: ' + b.name +
        ' is dead. ' + b.reward + 'cr paid by ' + SF.FACTION_BY_ID[b.sponsor].name + '.');
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      SF.Save.save();
      return true;
    },

    /* ---- quest-board section (called from station.js render) ---- */
    renderBoard: function (body) {
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = '☠ BOUNTY BOARD'; body.appendChild(h);
      var self = this;
      var atStation = true; // bounties turn in at ANY station
      this.offers().forEach(function (o) {
        var row = document.createElement('div');
        row.className = 'store-row';
        var fd = SF.FACTION_BY_ID[o.sponsor];
        var rl = o.renegade ? '<br>Affiliation: <span style="color:' + SF.FACTION_BY_ID[o.renegade].color +
          '">renegade ' + SF.FACTION_BY_ID[o.renegade].name + '</span> (killing them angers that faction)' : '';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">☠ ' + o.name + '</div>' +
          '<div class="store-desc">Ship: <b>' + o.shipClass + '</b> · Last seen: <b>' +
          SF.SYSTEM_BY_ID[o.system].name + '</b>' +
          '<br>Sponsor: <span style="color:' + fd.color + '">' + fd.name + '</span>' +
          ' · Reward: <b>' + o.reward + 'cr</b>' + rl + '</div></div></div>' +
          '<button class="btn store-btn"' + (self.active() ? ' disabled' : '') + '>HUNT</button>';
        row.querySelector('button').addEventListener('click', function () {
          if (self.accept(o.id)) SF.Station.renderStore();
        });
        body.appendChild(row);
      });
      var b = this.active();
      if (b) {
        var row2 = document.createElement('div');
        row2.className = 'store-row';
        var st = b.state === 'ready' ? '<b style="color:#3ddc5f">TARGET DOWN — collect</b>'
          : 'Status: <b>at large</b> (' + SF.SYSTEM_BY_ID[b.system].name + ')';
        row2.innerHTML =
          '<div class="store-info"><div><div class="store-name">▶ ' + b.name + '</div>' +
          '<div class="store-desc">Reward: <b>' + b.reward + 'cr</b><br>' + st + '</div></div></div>' +
          '<button class="btn store-btn"' + (b.state === 'ready' ? '' : ' disabled') + '>COLLECT</button>';
        row2.querySelector('button').addEventListener('click', function () { self.turnIn(); });
        body.appendChild(row2);
      }
    }
  };

  SF.Bounty = Bounty;
})();

/* ============================================================
 * STARFALL — encounter-variety phase (2026-10-19)
 *
 * SF.EncountersVariety: 4 new random-encounter archetypes on the
 * gameplay-depth framework (js/gameplay.js SF.Encounters). Runtime only,
 * save-neutral — no SF.SAVE_VERSION bump, no new save-blob fields.
 *
 *   distress-trap  — distress call that is ALWAYS a pirate trap. The
 *                     adrift "freighter" springs on proximity (380u),
 *                     on boarding (existing distressTrap hook), or when
 *                     fired upon: the wreck goes hostile and hidden
 *                     raiders converge.
 *   convoy-defense — ambushed trader convoy. Pirates run scripted raids
 *                     that chew the convoy's hull; every pirate the
 *                     player kills pays an escort bounty scaled by the
 *                     player's standing with the convoy faction ("reward
 *                     by standing"). Defend them all -> bonus standing;
 *                     lose them all -> standing hit.
 *   cargo-cache    — drifting cargo cache with a claim minigame. In
 *                     range, a world-space signal-sync ring appears: a
 *                     needle sweeps, FIRE latches when it crosses the
 *                     green arc. 3 latches claim the cache; a miss zaps
 *                     you; 2 misses blow the cache — it was bait, and
 *                     pirates pounce.
 *   duelist        — wandering elite duelist, 1v1, no adds (never the
 *                     swarmlord variant, no escalation wave). Elite kill
 *                     banner + duel banner + news echo.
 *
 * Every archetype posts a news-wire echo (SF.News). Spawn weights scale
 * with system danger (Solace < Drift < Ember) via SF.CONFIG.encounters.
 *
 * Integration is runtime-only from this file: the new kinds are pushed
 * onto SF.CONFIG.encounters tables at load, and SF.Encounters.run /
 * .tick / .reset plus SF.Enemies.kill / .draw are wrapped (never edited).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.EncountersVariety && SF.EncountersVariety._installed) return; // no double install

  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function toast(msg) { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function angDiff(a, b) {
    var d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  }

  var SYSTEM_FACTION = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  function diffOf(sysId) {
    return (SF.CONFIG.difficulty && SF.CONFIG.difficulty[sysId]) ||
      { label: 'CALM', budget: 1.0, dmgMul: 1.0, fireMul: 1.0 };
  }
  function sysName(sysId) {
    return SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].name : sysId;
  }
  function spawnNear(typeId, mul, opts, minD, maxD) {
    var p = SF.Player, cfg = SF.CONFIG;
    var a = Math.random() * Math.PI * 2;
    var d = (minD || 600) + Math.random() * ((maxD || 950) - (minD || 600));
    var x = p.x + Math.cos(a) * d;
    var y = p.y + Math.sin(a) * d;
    return SF.Enemies.spawn(typeId, x, y, mul, opts || {});
  }
  function dangerMul(sysId) {
    return { solace: 1.0, drift: 1.4, ember: 1.9 }[sysId] || 1.0;
  }

  /* ---------------- variety state (all runtime, none saved) ---------------- */
  var trapArmed = null;      // the distress-trap derelict awaiting its spring
  var convoyDefense = null;  // { faction, sys, raidT }
  var duel = null;           // current duelist enemy ref
  var caches = [];           // cargo-cache entities
  var prevFiring = false;    // fire rising-edge detector for the minigame

  var V = {
    _installed: true,
    caches: caches, // smoke-test visibility

    testState: function () {
      return {
        trapArmed: !!trapArmed,
        convoyDefense: convoyDefense ? { faction: convoyDefense.faction } : null,
        duel: !!duel,
        caches: caches.length
      };
    },

    /* ---- encounter runners (called from the wrapped SF.Encounters.run) ---- */

    runDistressTrap: function () {
      var sysId = SF.Game.systemId;
      var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
      var w = spawnNear('raider', mul,
        { encounter: 'distress-trap', distressTrap: true }, 500, 750);
      if (w) {
        w.adrift = true;
        w.crew = Math.max(w.crew, 2);
        w.varietyHp = w.hp; // fire-detection baseline
        trapArmed = w;
      }
      toast('\uD83C\uDD98 Distress beacon! A freighter, dead in the water.');
      news('\uD83D\uDCF0 Distress beacon reported in ' + sysName(sysId) +
        ' — salvagers advised to approach with caution.');
    },

    springTrap: function (w) {
      if (!w) return;
      var sysId = SF.Game.systemId;
      var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
      var diff = diffOf(sysId);
      var n = Math.max(2, Math.round(rint(2, 3) * diff.budget / 1.4));
      for (var i = 0; i < n; i++) {
        spawnNear(i === 0 ? 'gunship' : 'raider', mul,
          { encounter: 'distress-trap' }, 450, 700);
      }
      // the "wreck" was a pirate all along: hostile now
      w.distressTrap = false;
      w.adrift = false;
      w.hp = w.maxHp;
      w.crew = Math.max(w.crew, 2);
      if (trapArmed === w) trapArmed = null;
      toast('\u26A0 It was a trap! Pirates decloak all around you!');
      if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
      news('\uD83D\uDCF0 Pirate trap sprung in ' + sysName(sysId) +
        ' — the "distress call" was bait. One pilot walked straight in.');
    },

    runConvoyDefense: function () {
      var sysId = SF.Game.systemId;
      var diff = diffOf(sysId);
      var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
      var f = SYSTEM_FACTION[sysId];
      var fd = f && SF.FACTION_BY_ID[f];
      var m = Math.max(2, Math.round(3 * diff.budget / 1.4));
      for (var j = 0; j < m; j++) {
        var e = spawnNear(j === 0 ? 'gunship' : 'raider', mul,
          { faction: f, trader: true, encounter: 'convoy-defense' }, 600, 900);
        if (e) {
          var a = Math.random() * Math.PI * 2;
          e.vx = Math.cos(a) * 60; e.vy = Math.sin(a) * 60;
        }
      }
      var n = Math.max(2, Math.round(rint(3, 4) * diff.budget / 1.4));
      for (var i = 0; i < n; i++) {
        var t = Math.random() < 0.3 ? 'gunship' : 'raider';
        spawnNear(t, mul, { encounter: 'convoy-defense' }, 550, 850);
      }
      convoyDefense = { faction: f, sys: sysId, raidT: 2.0 };
      toast('\u26A0 Trader convoy under attack! Defend them — ' +
        (fd ? fd.name : 'the traders') + ' pays for pirate kills.');
      news('\uD83D\uDCF0 ' + (fd ? fd.name : 'Trader') + ' convoy ambushed in ' +
        sysName(sysId) + ' — escort bounty posted for its defense.');
    },

    runCargoCache: function () {
      var sysId = SF.Game.systemId;
      var p = SF.Player, cfg = SF.CONFIG;
      var a = Math.random() * Math.PI * 2;
      var d = 500 + Math.random() * 250;
      var x = p.x + Math.cos(a) * d;
      var y = p.y + Math.sin(a) * d;
      caches.push({
        x: x, y: y, r: 22,
        state: 'idle',            // idle -> armed -> opened | baited
        promptShown: false,
        latches: 0, need: 3, misses: 0,
        needle: Math.random() * Math.PI * 2,
        needleDir: 1, needleSpeed: 2.1,
        arcC: Math.random() * Math.PI * 2,
        arcHalf: 0.42,            // shrinks with each latch
        blink: Math.random() * 10,
        sys: sysId
      });
      toast('\uD83D\uDCE6 Drifting cargo cache on scope — something valuable inside.');
      news('\uD83D\uDCF0 Derelict cargo cache detected drifting in ' + sysName(sysId) + '.');
    },

    runDuelist: function () {
      var sysId = SF.Game.systemId;
      var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
      // 1v1 with no adds: never swarmlord (death-spawns 3 adds), no escalation wave
      var variant = sysId === 'ember' ? 'bulwark' : (Math.random() < 0.5 ? 'fast' : 'bulwark');
      var e = spawnNear('gunship', mul * 1.6,
        { encounter: 'duelist', elite: variant, duelist: true }, 600, 900);
      if (e) {
        duel = e;
        toast('\u2694 A lone pilot hails you: "Face me — one on one, no tricks!"');
        news('\uD83D\uDCF0 A duelist roams ' + sysName(sysId) +
          ', challenging worthy pilots to single combat.');
      }
    },

    /* smoke-test helper: force one latch attempt using the live needle angle */
    testLatch: function (i) {
      var c = caches[i || 0];
      if (c && c.state === 'armed') latchAttempt(c);
    }
  };

  SF.EncountersVariety = V;

  /* ---------------- convoy-defense internals ---------------- */

  function convoyTraders() {
    return SF.Enemies.list.filter(function (e) {
      return e.encounter === 'convoy-defense' && e.trader;
    });
  }
  function convoyPirates() {
    return SF.Enemies.list.filter(function (e) {
      return e.encounter === 'convoy-defense' && !e.faction && !e.trader;
    });
  }

  // scripted raid hit: pirates chewing convoy hull. Applied directly (not
  // through SF.Enemies.damage) so the game never blames the player.
  function raidHit(trader, frac) {
    trader.hp -= trader.maxHp * frac;
    trader.flash = 0.08;
    if (window.SF && SF.Particles) SF.Particles.burst(trader.x, trader.y, '#ff9d5e', 5, 200, 0.4, 3);
    if (trader.hp <= 0) {
      var idx = SF.Enemies.list.indexOf(trader);
      if (idx >= 0) SF.Enemies.list.splice(idx, 1);
      if (window.SF && SF.Particles) SF.Particles.explosion(trader.x, trader.y, 1.2);
      if (SF.Audio && SF.Audio.explosion) SF.Audio.explosion(true);
      toast('\uD83D\uDCA5 A trader goes down! The convoy is being torn apart!');
    }
  }

  // escort bounty for a convoy-defense pirate kill — scaled by standing.
  function escortBounty(e) {
    var f = convoyDefense.faction;
    var standing = (window.SF && SF.Factions) ? SF.Factions.standing(f) : 0;
    var base = e.type === 'gunship' ? 140 : (e.type === 'drone' ? 25 : 60);
    var pay = Math.round(base * dangerMul(convoyDefense.sys) * (1 + Math.max(0, standing) / 100));
    SF.Player.credits += pay;
    if (window.SF && SF.Factions) SF.Factions.shift(f, 1);
    var fname = f && SF.FACTION_BY_ID[f] ? SF.FACTION_BY_ID[f].name : 'the convoy';
    toast('\uD83D\uDCB0 Escort bounty +' + pay + 'cr · ' + fname + ' +1 standing');
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
  }

  function resolveConvoyDefense() {
    var f = convoyDefense.faction;
    var fd = f && SF.FACTION_BY_ID[f];
    var traders = convoyTraders();
    var pirates = convoyPirates();
    var sysId = convoyDefense.sys;
    if (pirates.length === 0 && traders.length > 0) {
      // convoy saved
      var bonus = 3 + traders.length;
      if (window.SF && SF.Factions) SF.Factions.shift(f, bonus);
      var pay = Math.round(150 * dangerMul(sysId) * traders.length);
      SF.Player.credits += pay;
      toast('\u2705 Convoy saved! ' + (fd ? fd.name : 'Traders') +
        ' +' + bonus + ' standing, +' + pay + 'cr escort bonus.');
      news('\uD83D\uDCF0 Convoy defended in ' + sysName(sysId) + ' — ' +
        (fd ? fd.name : 'the traders') + ' rewards its protector.');
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      convoyDefense = null;
    } else if (traders.length === 0) {
      // convoy lost
      if (window.SF && SF.Factions) SF.Factions.shift(f, -3);
      toast('\u2620 The convoy is gone. ' + (fd ? fd.name : 'The traders') +
        ' will remember you did nothing (-3 standing).');
      news('\uD83D\uDCF0 Trader convoy lost with all hands in ' + sysName(sysId) + '.');
      convoyDefense = null;
    }
  }

  /* ---------------- cargo-cache minigame ---------------- */

  function latchAttempt(c) {
    if (angDiff(c.needle, c.arcC) <= c.arcHalf) {
      c.latches++;
      c.arcC = Math.random() * Math.PI * 2;
      c.arcHalf = Math.max(0.26, c.arcHalf - 0.06);
      c.needleSpeed += 0.55;
      toast('\uD83D\uDD13 Latch ' + c.latches + '/' + c.need + ' — keep it steady!');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      if (c.latches >= c.need) claimCache(c);
    } else {
      c.misses++;
      if (window.SF && SF.Player.takeDamage) SF.Player.takeDamage(15);
      if (window.SF && SF.Particles) SF.Particles.burst(c.x, c.y, '#39d5e8', 8, 240, 0.4, 3);
      if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
      if (c.misses >= 2) {
        baitCache(c);
      } else {
        toast('\u26A1 Lock defense zaps you! One more miss and the cache blows.');
      }
    }
  }

  function claimCache(c) {
    c.state = 'opened';
    var dm = dangerMul(c.sys);
    var credits = rint(200, 600) * dm | 0;
    var ore = rint(3, 6 + Math.round(2 * dm));
    SF.Pickups.spawnCredits(c.x, c.y, credits);
    for (var i = 0; i < ore; i++) SF.Pickups.spawnOre(c.x, c.y, 1);
    var gotItem = false;
    if (Math.random() < 0.5 && SF.ITEMS && SF.ITEMS.length) {
      SF.Pickups.spawnItem(c.x, c.y, SF.ITEMS[rint(0, SF.ITEMS.length - 1)].id);
      gotItem = true;
    }
    if (window.SF && SF.Particles) SF.Particles.burst(c.x, c.y, '#3ddc5f', 16, 260, 0.6, 4);
    toast('\uD83D\uDCE6 Cache claimed! +' + credits + 'cr, +' + ore + ' ore' +
      (gotItem ? ' + component' : ''));
    news('\uD83D\uDCF0 Drifting cache claimed in ' + sysName(c.sys) + ' — contents undisclosed.');
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
    removeCache(c);
  }

  function baitCache(c) {
    c.state = 'baited';
    if (window.SF && SF.Particles) SF.Particles.explosion(c.x, c.y, 1.4);
    if (SF.Audio && SF.Audio.explosion) SF.Audio.explosion(true);
    var sysId = SF.Game.systemId;
    var mul = SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1;
    var n = Math.max(1, Math.round(1 + dangerMul(sysId) / 2));
    for (var i = 0; i < n; i++) {
      spawnNear('raider', mul, { encounter: 'cache-bait' }, 350, 550);
    }
    toast('\uD83D\uDCA5 It was bait! Pirates pounce from the wreckage!');
    news('\uD83D\uDCF0 The "cache" in ' + sysName(sysId) +
      ' was a pirate lure — a pilot walked right into it.');
    removeCache(c);
  }

  function removeCache(c) {
    var i = caches.indexOf(c);
    if (i >= 0) caches.splice(i, 1);
  }

  /* ---------------- per-frame variety update ---------------- */

  function varietyTick(dt) {
    var p = SF.Player;

    // distress-trap: spring on proximity or when fired upon (boarding is
    // handled by the existing distressTrap hook in boarding.js)
    if (trapArmed) {
      if (SF.Enemies.list.indexOf(trapArmed) < 0) {
        trapArmed = null; // player killed it before it sprung — fair
      } else {
        var d = Math.hypot(p.x - trapArmed.x, p.y - trapArmed.y);
        if (d < 380 || trapArmed.hp < trapArmed.varietyHp) {
          V.springTrap(trapArmed);
        }
      }
    }

    // convoy-defense: scripted pirate raids chew convoy hull
    if (convoyDefense) {
      convoyDefense.raidT -= dt;
      if (convoyDefense.raidT <= 0) {
        convoyDefense.raidT = 3.5;
        var pirates = convoyPirates();
        var traders = convoyTraders();
        if (pirates.length && traders.length) {
          var t = traders[rint(0, traders.length - 1)];
          raidHit(t, 0.06 + Math.random() * 0.05);
        }
      }
      resolveConvoyDefense();
    }

    // duelist: drop the ref if it died or left the list some other way
    if (duel && SF.Enemies.list.indexOf(duel) < 0) duel = null;

    // cargo caches: prompt + signal-sync minigame
    var firing = !!(window.SF && SF.Input && SF.Input.firing);
    var fireEdge = firing && !prevFiring;
    prevFiring = firing;
    for (var i = caches.length - 1; i >= 0; i--) {
      var c = caches[i];
      c.blink += dt;
      var dc = Math.hypot(p.x - c.x, p.y - c.y);
      if (c.state === 'idle' && dc < 300) {
        c.state = 'armed';
        if (!c.promptShown) {
          c.promptShown = true;
          toast('\uD83D\uDCE6 Cache in range — tap FIRE to crack the lock when the needle crosses the green arc.');
        }
      }
      if (c.state === 'armed') {
        if (dc > 900) { c.state = 'idle'; continue; } // walked away
        c.needle += c.needleDir * c.needleSpeed * dt;
        if (c.needle > Math.PI * 2) { c.needle -= Math.PI * 2; c.needleDir *= -1; }
        if (c.needle < 0) { c.needle += Math.PI * 2; c.needleDir *= -1; }
        if (fireEdge) latchAttempt(c);
      }
    }
  }

  /* ---------------- cache rendering (world space) ---------------- */

  function drawCaches(ctx) {
    for (var i = 0; i < caches.length; i++) {
      var c = caches[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      // container body
      ctx.fillStyle = '#2b3a4a';
      ctx.strokeStyle = '#7f93a8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-c.r, -c.r * 0.7, c.r * 2, c.r * 1.4, 5);
      else ctx.rect(-c.r, -c.r * 0.7, c.r * 2, c.r * 1.4);
      ctx.fill(); ctx.stroke();
      // hazard stripes
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-c.r, -c.r * 0.7, c.r * 2, c.r * 1.4, 5);
      else ctx.rect(-c.r, -c.r * 0.7, c.r * 2, c.r * 1.4);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,180,60,0.55)';
      for (var s = -2; s < 3; s++) {
        ctx.save();
        ctx.translate(s * 14, 0);
        ctx.rotate(0.6);
        ctx.fillRect(-3, -c.r, 6, c.r * 2);
        ctx.restore();
      }
      ctx.restore();
      // blinking beacon
      var bl = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(c.blink * 5));
      ctx.fillStyle = 'rgba(255,90,90,' + bl.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(0, -c.r * 0.7 - 6, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // name tag
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd27f';
      ctx.fillText('\uD83D\uDCE6 CACHE', c.x, c.y - c.r - 16);

      // signal-sync minigame ring
      if (c.state === 'armed') {
        var R = 52;
        ctx.save();
        ctx.strokeStyle = 'rgba(57,213,232,0.35)';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
        // target arc (green)
        ctx.strokeStyle = '#3ddc5f';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, c.arcC - c.arcHalf, c.arcC + c.arcHalf);
        ctx.stroke();
        // needle
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(c.needle) * R, c.y + Math.sin(c.needle) * R);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
        // latch pips
        for (var q = 0; q < c.need; q++) {
          ctx.fillStyle = q < c.latches ? '#3ddc5f' : 'rgba(255,255,255,0.25)';
          ctx.beginPath();
          ctx.arc(c.x - (c.need - 1) * 9 + q * 18, c.y + R + 14, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  /* ---------------- runtime wiring (wraps, never edits) ---------------- */

  // spawn weights tuned to system danger: Solace < Drift < Ember
  (function installTables() {
    var add = {
      solace: [['distress-trap', 3], ['convoy-defense', 2], ['cargo-cache', 4], ['duelist', 2]],
      drift:  [['distress-trap', 6], ['convoy-defense', 3], ['cargo-cache', 5], ['duelist', 3]],
      ember:  [['distress-trap', 8], ['convoy-defense', 4], ['cargo-cache', 6], ['duelist', 4]]
    };
    Object.keys(add).forEach(function (sys) {
      var t = SF.CONFIG.encounters && SF.CONFIG.encounters[sys];
      if (!t) return;
      add[sys].forEach(function (row) {
        var exists = t.some(function (r) { return r[0] === row[0]; });
        if (!exists) t.push([row[0], row[1]]);
      });
    });
  })();

  if (window.SF && SF.Encounters) {
    var _run = SF.Encounters.run;
    SF.Encounters.run = function (kind) {
      // early-game-difficulty-1: scripted set-pieces sit the rookie
      // window out in Solace — the elite DUELIST, the distress TRAP pack
      // and the convoy-defense pirate raid all downgrade to a plain
      // patrol. (Cargo-cache is harmless and not hostile-gated.)
      if ((kind === 'duelist' || kind === 'distress-trap' ||
           kind === 'convoy-defense') && SF.Enemies.rookieFactor &&
          SF.Enemies.rookieFactor(SF.Game.systemId).active) {
        return _run.call(SF.Encounters, 'patrol');
      }
      switch (kind) {
        case 'distress-trap': V.runDistressTrap(); return;
        case 'convoy-defense': V.runConvoyDefense(); return;
        case 'cargo-cache': V.runCargoCache(); return;
        case 'duelist': V.runDuelist(); return;
        default: return _run.call(SF.Encounters, kind);
      }
    };

    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      varietyTick(dt);
    };

    var _reset = SF.Encounters.reset;
    SF.Encounters.reset = function () {
      _reset.call(SF.Encounters);
      trapArmed = null; convoyDefense = null; duel = null;
      caches.length = 0; prevFiring = false;
    };
  }

  if (window.SF && SF.Enemies) {
    var _kill = SF.Enemies.kill;
    SF.Enemies.kill = function (e) {
      var isConvoyPirate = e.encounter === 'convoy-defense' && !e.faction;
      var isDuelist = e.encounter === 'duelist';
      var dName = e.eliteName, dSys = SF.Game.systemId;
      _kill.call(SF.Enemies, e);
      if (isConvoyPirate && convoyDefense) escortBounty(e);
      if (isDuelist) {
        duel = null;
        toast('\u2694 DUEL WON — ' + (dName || 'the duelist') + ' falls!');
        news('\uD83D\uDCF0 ' + (dName || 'A wandering duelist') +
          ' defeated in single combat in ' + sysName(dSys) + '.');
      }
    };

    var _draw = SF.Enemies.draw;
    SF.Enemies.draw = function (ctx) {
      _draw.call(SF.Enemies, ctx);
      drawCaches(ctx);
    };
  }
})();
/* ============================================================
 * STARFALL — deployable-mining-outposts phase (2026-10-19)
 *
 * SF.Outposts: deployable mining outposts anchored to rich asteroids.
 *
 *   DEPLOY  — while PLAYING, fly within DEPLOY_RANGE of a RICH asteroid
 *             (richness >= 0.6, same metric as the mining minigame's
 *             sweet-spot bar) and a deploy prompt appears: press F or tap
 *             DEPLOY to anchor an outpost for 3000c. The outpost is bolted
 *             to the rock's position at deploy time.
 *   TRICKLE — each outpost accrues 2t of ore per 5 minutes of real PLAYING
 *             time, capped at 20t in its own hold.
 *   HAUL    — fly within PICKUP_RANGE and the outpost's hold auto-transfers
 *             into your cargo (respecting free cargo space).
 *   LIMIT   — max 3 outposts across all systems.
 *
 * Persistence is additive on the existing trading blob
 * (SF.Player.markets._outposts), with defensive reads everywhere —
 * save-neutral: no SF.SAVE_VERSION bump, no migration needed.
 *
 * Integration is runtime-only from this file, in the style of the
 * encounter-variety phase above: SF.Encounters.tick is chained (never
 * edited), SF.Asteroids.draw is wrapped to render outpost structures in
 * world space, SF.HUD.hidePrompts is wrapped to drop the deploy prompt
 * on state changes, and a KeyF listener + a DOM deploy button (mirroring
 * the dock/board/investigate prompts) are created additively.
 *
 * Nothing in this file touches the live tree; the safe-room audit copies
 * the changed file into a combined tree and runs smoke.mjs --base <dir>.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.Outposts && SF.Outposts._installed) return; // no double install

  /* ---------------- tuning ---------------- */
  var COST = 3000;            // credits to anchor an outpost
  var MAX = 3;                // max outposts across all systems
  var ORE_PER_CYCLE = 2;      // tons per accrual cycle
  var CYCLE_SEC = 300;        // 5 minutes of real PLAYING time per cycle
  var HOLD_CAP = 20;          // outpost hold cap (tons)
  var DEPLOY_RANGE = 300;     // must be this close to the rock to deploy
  var PICKUP_RANGE = 260;     // fly within this to auto-transfer ore
  var CLAIM_RADIUS = 140;     // no second outpost within this of an existing one
  var RICH_MIN = 0.6;         // rock must be at least this rich (0..1)
  var AMBER = '#ffb545';      // outpost accent color

  function toast(msg) { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }

  /* ---------------- persistent blob (defensive, like _contracts) ---------------- */
  function blob() {
    var p = SF.Player;
    if (!p) return { outposts: [] }; // pre-game: read-only empty view
    if (!p.markets || typeof p.markets !== 'object' || Array.isArray(p.markets)) p.markets = {};
    var o = p.markets._outposts;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      o = { outposts: [] };
      p.markets._outposts = o;
    }
    if (!Array.isArray(o.outposts)) o.outposts = [];
    // normalize entries (old/corrupt blobs stay loadable)
    for (var i = 0; i < o.outposts.length; i++) {
      var e = o.outposts[i];
      if (!e || typeof e !== 'object') { o.outposts.splice(i, 1); i--; continue; }
      // outpost-upgrades phase: additive tier fields (save-neutral)
      e.drill = (e.drill === 2 || e.drill === 3) ? e.drill : 1;
      e.holdCap = (e.holdCap === 35) ? 35 : 20;
      e.turret = !!e.turret;
      e.hull = e.turret ? 300 : 0;
      e.hold = Math.max(0, Math.min(e.holdCap, Math.floor(e.hold || 0)));
      e.acc = Math.max(0, Math.min(CYCLE_SEC, e.acc || 0));
      e.x = +e.x || 0; e.y = +e.y || 0;
      e.systemId = e.systemId || 'solace';
    }
    return o;
  }

  /* same richness metric as the mining minigame (bigger rocks = richer) */
  function richness(a) {
    var cfg = SF.CONFIG.asteroid;
    return Math.max(0, Math.min(1,
      (a.r - cfg.radiusMin) / Math.max(1, cfg.radiusMax - cfg.radiusMin)));
  }

  function dist2(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  function nearOutpost(x, y, r) {
    var list = blob().outposts;
    for (var i = 0; i < list.length; i++) {
      if (dist2(x, y, list[i].x, list[i].y) < r * r) return list[i];
    }
    return null;
  }

  var O = {
    _installed: true,
    COST: COST, MAX: MAX, ORE_PER_CYCLE: ORE_PER_CYCLE,
    CYCLE_SEC: CYCLE_SEC, HOLD_CAP: HOLD_CAP,
    DEPLOY_RANGE: DEPLOY_RANGE, PICKUP_RANGE: PICKUP_RANGE, RICH_MIN: RICH_MIN,

    list: function () { return blob().outposts.slice(); },
    count: function () { return blob().outposts.length; },
    richness: richness,

    /* eligibility check for anchoring an outpost on asteroid `a` */
    canDeploy: function (a) {
      if (!a || a.dead) return { ok: false, reason: 'No asteroid targeted.' };
      if (richness(a) < RICH_MIN)
        return { ok: false, reason: 'That rock is not rich enough — find a bigger asteroid.' };
      if (nearOutpost(a.x, a.y, CLAIM_RADIUS))
        return { ok: false, reason: 'An outpost is already anchored here.' };
      if (blob().outposts.length >= MAX)
        return { ok: false, reason: 'Outpost limit reached (' + MAX + ' deployed).' };
      if (SF.Player.credits < COST)
        return { ok: false, reason: 'Need ' + COST.toLocaleString('en-US') + 'c to anchor an outpost.' };
      return { ok: true };
    },

    /* anchor the outpost: exact COST deduction, persistent blob write */
    deploy: function (a) {
      var chk = this.canDeploy(a);
      if (!chk.ok) {
        toast(chk.reason);
        if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
        return false;
      }
      SF.Player.credits -= COST;
      blob().outposts.push({
        id: 'op' + Date.now().toString(36) + Math.floor(Math.random() * 999),
        systemId: SF.Game.systemId,
        x: Math.round(a.x), y: Math.round(a.y),
        hold: 0, acc: 0,
        drill: 1, holdCap: HOLD_CAP, turret: false, hull: 0 // outpost-upgrades tiers
      });
      toast('⛏ Mining outpost anchored — 2t/5min, hold 20t. Fly close to haul.');
      news('\uD83D\uDCF0 Mining outpost established in ' +
        (SF.SYSTEM_BY_ID[SF.Game.systemId] ? SF.SYSTEM_BY_ID[SF.Game.systemId].name : SF.Game.systemId) +
        ' — private claim, 3,000c invested.');
      if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
      if (window.SF && SF.Particles) SF.Particles.burst(a.x, a.y, AMBER, 18, 240, 0.7, 4);
      SF.Save.save();
      return true;
    },

    /* test hook: advance every outpost's play-time clock by `sec` seconds */
    testAccrue: function (sec) {
      var list = blob().outposts;
      for (var i = 0; i < list.length; i++) accrue(list[i], sec || 0);
      return this.testState();
    },

    /* test hook: rich asteroids currently in the live field */
    testRich: function () {
      var out = [], list = SF.Asteroids.list || [];
      for (var i = 0; i < list.length; i++) {
        if (!list[i].dead && richness(list[i]) >= RICH_MIN) out.push(list[i]);
      }
      return out;
    },

    testState: function () {
      var list = blob().outposts;
      return {
        count: list.length,
        holds: list.map(function (o) { return o.hold; }),
        promptVisible: !!(deployPromptEl && !deployPromptEl.classList.contains('hidden'))
      };
    }
  };

  SF.Outposts = O;

  /* ---------------- accrual ---------------- */

  function accrue(o, dt) {
    // outpost-upgrades phase: per-outpost drill rate + hold cap (base tuning fallback)
    var U = window.SF && SF.OutpostUpgrades;
    var rate = (U && U.drillRate) ? U.drillRate(o) : ORE_PER_CYCLE;
    var cap = (U && U.holdCap) ? U.holdCap(o) : HOLD_CAP;
    var wasFull = o.hold >= cap; // sfx-hooks-v34b-retry: outpost_full edge
    o.acc = (o.acc || 0) + dt;
    while (o.acc >= CYCLE_SEC && o.hold < cap) {
      o.acc -= CYCLE_SEC;
      o.hold = Math.min(cap, o.hold + rate);
    }
    if (o.hold >= cap) {
      o.acc = Math.min(o.acc, CYCLE_SEC); // don't bank ahead
      if (!wasFull && SF.Audio && SF.Audio.lifepod) SF.Audio.lifepod(); // sfx-hooks-v34b-retry: outpost_full
    }
  }

  /* ---------------- deploy prompt (DOM, additive) ---------------- */

  var deployPromptEl = null, deployBtnEl = null;
  var promptTarget = null;  // asteroid the prompt is currently offered for
  var deployWanted = false; // set by the KeyF listener, consumed by the tick

  function ensurePromptDom() {
    if (deployPromptEl) return;
    var d = document.createElement('div');
    d.id = 'deploy-prompt';
    d.className = 'hidden';
    d.style.cssText = 'position:fixed;bottom:calc(210px + env(safe-area-inset-bottom));' +
      'left:50%;transform:translateX(-50%);z-index:26;';
    var b = document.createElement('button');
    b.id = 'btn-deploy';
    b.className = 'btn big ui-block';
    b.textContent = '⛏ DEPLOY MINING OUTPOST [F]';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (promptTarget) O.deploy(promptTarget);
    });
    d.appendChild(b);
    document.body.appendChild(d);
    deployPromptEl = d;
    deployBtnEl = b;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'KeyF' && !e.repeat) deployWanted = true;
    });
  }

  function hideDeployPrompt() {
    if (deployPromptEl) deployPromptEl.classList.add('hidden');
    promptTarget = null;
  }

  function findDeployTarget() {
    var p = SF.Player;
    var b = blob();
    if (!p || p.credits < COST) return null;
    if (b.outposts.length >= MAX) return null;
    var best = null, bestD = DEPLOY_RANGE;
    var list = SF.Asteroids.list || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.dead || richness(a) < RICH_MIN) continue;
      if (nearOutpost(a.x, a.y, CLAIM_RADIUS)) continue;
      var d = Math.sqrt(dist2(p.x, p.y, a.x, a.y));
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /* ---------------- per-tick update (PLAYING only) ---------------- */

  function tick(dt) {
    ensurePromptDom();
    var p = SF.Player, sysId = SF.Game.systemId;
    var list = blob().outposts;

    // 1) accrue ore + proximity haul
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      accrue(o, dt);
      if (o.systemId !== sysId || o.hold < 1) continue;
      if (dist2(p.x, p.y, o.x, o.y) > PICKUP_RANGE * PICKUP_RANGE) continue;
      var space = Math.max(0, Math.floor(p.cargoSpace() - p.cargoUsed()));
      var t = Math.min(o.hold, space);
      if (t > 0) {
        o.hold -= t;
        p.ore = (p.ore || 0) + t;
        toast('⛏ Outpost haul: +' + t + 't ore in hold');
        if (SF.Audio && SF.Audio.pickup) SF.Audio.pickup();
      }
    }

    // 2) deploy prompt from the mining flow (near a rich, unclaimed rock)
    promptTarget = findDeployTarget();
    var show = !!promptTarget && SF.Game.state === 'PLAYING';
    deployPromptEl.classList.toggle('hidden', !show);
    if (show && deployBtnEl) {
      deployBtnEl.textContent = '⛏ DEPLOY MINING OUTPOST — 3,000c [F]';
    }

    // 3) consume the F key
    if (deployWanted) {
      deployWanted = false;
      if (promptTarget) O.deploy(promptTarget);
    }
  }

  /* ---------------- world-space rendering (additive wrap) ---------------- */

  function drawOutposts(ctx) {
    var sysId = SF.Game.systemId;
    var list = blob().outposts;
    var p = SF.Player;
    var t = performance.now() / 1000;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.systemId !== sysId) continue;
      ctx.save();
      ctx.translate(o.x, o.y);
      // landing pad
      ctx.fillStyle = '#1c2436';
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var k = 0; k < 6; k++) {
        var ang = (k / 6) * Math.PI * 2 + Math.PI / 6;
        var px = Math.cos(ang) * 26, py = Math.sin(ang) * 26;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // habitat dome
      ctx.fillStyle = '#31405c';
      ctx.beginPath(); ctx.arc(0, -4, 11, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(255,181,69,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      // drill mast
      ctx.strokeStyle = '#8fa3c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, 2); ctx.lineTo(18, 22); ctx.stroke();
      ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.arc(18, 22, 3, 0, Math.PI * 2); ctx.fill();
      if (o.turret) {
        // v2-fx-wiring: file-backed point-defense turret (fx/turrets/laser);
        // loader-null keeps the original armored dome + barrel draw.
        if (!drawOutposts._turretWarm) {
          drawOutposts._turretWarm = true;
          if (window.SF && SF.Sprites) SF.Sprites.preload('fx/turrets', ['laser']);
        }
        var tImg = (window.SF && SF.Sprites) ? SF.Sprites.get('fx/turrets', 'laser') : null;
        if (tImg) {
          ctx.drawImage(tImg, -14 - 15, 6 - 15, 30, 30);
        } else {
          // outpost-upgrades: point-defense turret — armored dome + barrel
          ctx.fillStyle = '#5a6b8f';
          ctx.beginPath(); ctx.arc(-14, 6, 7, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.strokeStyle = '#c8d4ea'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(-26, -4); ctx.stroke();
        }
      }
      // blinking beacon
      var bl = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 + i));
      ctx.fillStyle = 'rgba(255,181,69,' + bl.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(-10, -18, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // pickup-range ring when the player is nearby
      var pd = Math.sqrt(dist2(p.x, p.y, o.x, o.y));
      if (pd < PICKUP_RANGE * 2.6) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,181,69,0.35)';
        ctx.setLineDash([10, 10]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(o.x, o.y, PICKUP_RANGE, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // hold bar + label (outpost-upgrades: dynamic cap + turret glyph)
      var hw = 64, capLbl = o.holdCap || HOLD_CAP;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(o.x - hw / 2, o.y - 52, hw, 8);
      ctx.fillStyle = AMBER;
      ctx.fillRect(o.x - hw / 2, o.y - 52, hw * (o.hold / capLbl), 8);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = AMBER;
      ctx.fillText('⛏ OUTPOST ' + o.hold + '/' + capLbl + 't' + (o.turret ? ' 🛡' : ''),
        o.x, o.y - 58);
      ctx.restore();
    }
  }

  /* ---------------- runtime wiring (lazy: HUD loads after this file) ---------------- */

  var hooksInstalled = false;
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    if (SF.Asteroids && SF.Asteroids.draw && !SF.Asteroids.draw._outposts) {
      var _draw = SF.Asteroids.draw;
      var wrapped = function (ctx) { _draw.call(SF.Asteroids, ctx); drawOutposts(ctx); };
      wrapped._outposts = true;
      SF.Asteroids.draw = wrapped;
    }
    if (SF.HUD && SF.HUD.hidePrompts && !SF.HUD.hidePrompts._outposts) {
      var _hide = SF.HUD.hidePrompts;
      var wrappedH = function () { _hide.call(SF.HUD); hideDeployPrompt(); };
      wrappedH._outposts = true;
      SF.HUD.hidePrompts = wrappedH;
    }
  }

  // chain onto the encounter tick (PLAYING-only update path, same as variety)
  if (window.SF && SF.Encounters && !SF.Encounters._outpostsHooked) {
    SF.Encounters._outpostsHooked = true;
    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      installHooks();
      tick(dt);
    };
  }
})();
/* ============================================================
 * STARFALL — outpost-upgrades phase (2026-10-20)
 *
 * SF.OutpostUpgrades: upgrade tiers for deployable mining outposts
 * (the mining-outposts phase, same file). Per-outpost additive fields:
 *
 *   drill   1|2|3      Drill Mk1 (2t/5min) -> Mk2 6,000c (3t/5min)
 *                      -> Mk3 14,000c (5t/5min)
 *   holdCap 20|35      Hold expansion 4,000c: 20t -> 35t
 *   turret  bool       Defense turret 8,000c: outpost fires on raiders,
 *                      hull 300
 *
 * RAIDS — each outpost rolls an 8% chance per real PLAYING hour for a
 * pirate probe. In-system, the probe is a real adrift SF.Enemies drone
 * steered onto the outpost by this phase; the turret (if installed)
 * fires friendly bolts and shreds it before arrival. An undefended
 * outpost loses 30% of its hold (min 2t) when the probe arrives.
 * Off-system raids resolve abstractly (same odds, news echo).
 *
 * Persistence is additive on the existing outpost records
 * (SF.Player.markets._outposts), normalized defensively in the
 * mining-outposts blob() — save-neutral: no SF.SAVE_VERSION bump.
 *
 * Integration is runtime-only from this file, in the style of the
 * earlier phases: SF.Encounters.tick is chained (never edited),
 * SF.HUD.hidePrompts is wrapped to drop the upgrade panel on state
 * changes, and the buy panel is additive DOM mirroring the deploy
 * prompt. Nothing in this file touches the live tree; the safe-room
 * audit copies the changed file into a combined tree and runs
 * smoke.mjs --base <dir>.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.OutpostUpgrades && SF.OutpostUpgrades._installed) return; // no double install

  /* ---------------- tuning ---------------- */
  var DRILL_COST = { 2: 6000, 3: 14000 }; // Mk1 -> Mk2 -> Mk3
  var DRILL_RATE = { 1: 2, 2: 3, 3: 5 };   // tons per 5-minute cycle
  var HOLD_EXPAND_COST = 4000;
  var HOLD_EXPANDED = 35;
  var TURRET_COST = 8000;
  var TURRET_HULL = 300;
  var RAID_CHANCE_PER_HOUR = 0.08; // per outpost, per real PLAYING hour
  var RAID_HOUR_SEC = 3600;
  var PROBE_HP = 120;
  var PROBE_SPEED = 70;          // u/s glide onto the outpost
  var PROBE_SPAWN_DIST = 420;    // inside turret range so a defended kill is guaranteed
  var PROBE_ARRIVE_DIST = 60;
  var TURRET_RANGE = 520;
  var TURRET_PERIOD = 1.2;        // seconds between volleys
  var TURRET_DMG = 40;            // 3 volleys kill a 120hp probe (~3.6s < ~6s flight)
  var TURRET_SHOT_SPEED = 900;
  var AMBER = '#ffb545';

  function toast(msg) { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function deny() { if (SF.Audio && SF.Audio.deny) SF.Audio.deny(); }
  function cr(n) { return n.toLocaleString('en-US') + 'c'; }

  var U = {
    _installed: true,

    /* per-outpost drill yield (t per 5-min cycle); defensive fallback to base rate */
    drillRate: function (o) { return DRILL_RATE[(o && o.drill) || 1] || DRILL_RATE[1]; },
    /* per-outpost hold cap; defensive fallback to the base 20t */
    holdCap: function (o) { return (o && o.holdCap === HOLD_EXPANDED) ? HOLD_EXPANDED : 20; },

    DRILL_COST: DRILL_COST, DRILL_RATE: DRILL_RATE,
    HOLD_EXPAND_COST: HOLD_EXPAND_COST, HOLD_EXPANDED: HOLD_EXPANDED,
    TURRET_COST: TURRET_COST, TURRET_HULL: TURRET_HULL,
    RAID_CHANCE_PER_HOUR: RAID_CHANCE_PER_HOUR,

    /* ---- purchases: exact deductions, refusals with reasons ---- */

    buyDrill: function (o) {
      if (!o) return false;
      var next = ((o.drill || 1) + 1);
      if (next > 3) { toast('Drill already at Mk3.'); deny(); return false; }
      var cost = DRILL_COST[next];
      if (SF.Player.credits < cost) {
        toast('Need ' + cr(cost) + ' for Drill Mk' + next + '.'); deny(); return false;
      }
      SF.Player.credits -= cost;
      o.drill = next;
      toast('⛏ Drill upgraded → Mk' + next + ' (' + DRILL_RATE[next] +
        't/5min) — ' + cr(cost));
      buyFx(); SF.Save.save(); renderPanel(true);
      return true;
    },

    buyHold: function (o) {
      if (!o) return false;
      if (o.holdCap === HOLD_EXPANDED) { toast('Hold already expanded.'); deny(); return false; }
      if (SF.Player.credits < HOLD_EXPAND_COST) {
        toast('Need ' + cr(HOLD_EXPAND_COST) + ' to expand the hold.'); deny(); return false;
      }
      SF.Player.credits -= HOLD_EXPAND_COST;
      o.holdCap = HOLD_EXPANDED;
      toast('⛏ Hold expanded → ' + HOLD_EXPANDED + 't — ' + cr(HOLD_EXPAND_COST));
      buyFx(); SF.Save.save(); renderPanel(true);
      return true;
    },

    buyTurret: function (o) {
      if (!o) return false;
      if (o.turret) { toast('Turret already installed.'); deny(); return false; }
      if (SF.Player.credits < TURRET_COST) {
        toast('Need ' + cr(TURRET_COST) + ' for the defense turret.'); deny(); return false;
      }
      SF.Player.credits -= TURRET_COST;
      o.turret = true;
      o.hull = TURRET_HULL;
      toast('🛡 Defense turret installed — hull ' + TURRET_HULL + ', shoots raiders — ' + cr(TURRET_COST));
      news('📻 A private mining outpost just grew teeth — point-defense turret online.');
      buyFx(); SF.Save.save(); renderPanel(true);
      return true;
    },

    /* ---- test hooks (audit contract) ---- */

    /* force a visible raid probe on outpost i (spawned at range, steered in by testStep) */
    testRaid: function (i) {
      var list = SF.Outposts ? SF.Outposts.list() : [];
      var o = list[i || 0];
      if (!o) return { ok: false, reason: 'no outpost' };
      startRaid(o, true);
      return { ok: true, probes: probes.length };
    },

    /* deterministically advance the probe sim in fixed 0.05s steps */
    testStep: function (sec) {
      var n = Math.max(1, Math.round((sec || 1) / 0.05));
      for (var k = 0; k < n; k++) raidProbeSim(0.05);
      return { probes: probes.length };
    },

    /* read-only view for the smoke test */
    testState: function () {
      return {
        panelVisible: !!(panelEl && !panelEl.classList.contains('hidden')),
        probes: probes.length
      };
    }
  };

  SF.OutpostUpgrades = U;

  function buyFx() {
    if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
  }

  /* ---------------- upgrade panel (additive DOM, mirrors the deploy prompt) ---------------- */

  var panelEl = null, panelTarget = null, holdSpan = null;

  function ensurePanelDom() {
    if (panelEl) return;
    var d = document.createElement('div');
    d.id = 'outpost-panel';
    d.className = 'hidden';
    d.style.cssText = 'position:fixed;right:12px;bottom:calc(230px + env(safe-area-inset-bottom));' +
      'z-index:26;min-width:230px;max-width:300px;background:rgba(8,12,24,0.92);' +
      'border:1px solid rgba(255,181,69,0.55);border-radius:10px;padding:10px 12px;' +
      'font-family:monospace;color:#dfe7f5;';
    document.body.appendChild(d);
    panelEl = d;
  }

  function hidePanel() {
    if (panelEl) panelEl.classList.add('hidden');
    panelTarget = null;
  }

  function row(name, desc, btnLabel, enabled, onClick) {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
      'gap:8px;margin:7px 0;';
    var info = document.createElement('div');
    var nm = document.createElement('div');
    nm.style.cssText = 'font-weight:bold;font-size:12px;color:' + AMBER + ';';
    nm.textContent = name;
    var ds = document.createElement('div');
    ds.style.cssText = 'font-size:11px;color:#9fb0cc;';
    ds.textContent = desc;
    info.appendChild(nm); info.appendChild(ds);
    var b = document.createElement('button');
    b.className = 'btn ui-block';
    b.style.cssText = 'font-size:11px;padding:7px 9px;white-space:nowrap;' +
      (enabled ? '' : 'opacity:0.45;');
    b.textContent = btnLabel;
    if (enabled) b.addEventListener('click', function (e) { e.preventDefault(); onClick(); });
    else b.setAttribute('disabled', 'disabled');
    r.appendChild(info); r.appendChild(b);
    return r;
  }

  function renderPanel(force) {
    ensurePanelDom();
    if (!panelEl || panelEl.classList.contains('hidden')) {
      if (!force) return;
    }
    var o = panelTarget;
    if (!o) { hidePanel(); return; }
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);
    var head = document.createElement('div');
    head.style.cssText = 'font-weight:bold;font-size:13px;color:' + AMBER + ';margin-bottom:2px;';
    head.textContent = '⛏ MINING OUTPOST';
    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:#9fb0cc;margin-bottom:4px;';
    sub.innerHTML = 'hold <b></b>t · ' + (o.turret ? '🛡 turret online · hull ' + o.hull + '/300' : 'no defenses');
    holdSpan = sub.querySelector('b');
    panelEl.appendChild(head); panelEl.appendChild(sub);

    var drill = o.drill || 1;
    var credits = SF.Player.credits;
    panelEl.appendChild(row(
      'Drill Mk' + drill,
      'mines ' + U.drillRate(o) + 't per 5 min' + (drill < 3 ? ' → Mk' + (drill + 1) + ': ' + U.drillRate({ drill: drill + 1 }) + 't/5min' : ''),
      drill >= 3 ? 'MAX' : 'UPGRADE · ' + cr(DRILL_COST[drill + 1]),
      drill < 3 && credits >= DRILL_COST[drill + 1],
      function () { U.buyDrill(o); }
    ));
    panelEl.appendChild(row(
      'Ore hold',
      o.hold + '/' + U.holdCap(o) + 't' + (o.holdCap < HOLD_EXPANDED ? ' → expand to ' + HOLD_EXPANDED + 't' : ''),
      o.holdCap >= HOLD_EXPANDED ? 'MAX' : 'EXPAND · ' + cr(HOLD_EXPAND_COST),
      o.holdCap < HOLD_EXPANDED && credits >= HOLD_EXPAND_COST,
      function () { U.buyHold(o); }
    ));
    panelEl.appendChild(row(
      'Point-defense turret',
      o.turret ? 'shoots raiders that attack the outpost' : 'auto-fires on pirate probes · hull 300',
      o.turret ? 'INSTALLED ✓' : 'INSTALL · ' + cr(TURRET_COST),
      !o.turret && credits >= TURRET_COST,
      function () { U.buyTurret(o); }
    ));
    updateHoldReadout(o);
  }

  function updateHoldReadout(o) {
    if (holdSpan && o) holdSpan.textContent = o.hold + '/' + U.holdCap(o);
  }

  function panelTick() {
    ensurePanelDom();
    var target = null;
    if (SF.Game.state === 'PLAYING' && SF.Outposts) {
      var p = SF.Player, range = SF.Outposts.PICKUP_RANGE;
      var list = SF.Outposts.list(), bestD = range;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o.systemId !== SF.Game.systemId) continue;
        var d = Math.hypot(p.x - o.x, p.y - o.y);
        if (d < bestD) { bestD = d; target = o; }
      }
    }
    if (target !== panelTarget) { panelTarget = target; renderPanel(true); }
    panelEl.classList.toggle('hidden', !target);
    if (target) updateHoldReadout(target);
  }

  /* ---------------- raids ---------------- */

  var probes = []; // { e, o, t } live raid probes

  /* hourly roll per outpost — separated from the probe sim so tests can drive it */
  function raidHourly(dt) {
    if (!SF.Outposts) return;
    var inSys = SF.Game.systemId;
    var list = SF.Outposts.list();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      o.raidAcc = (o.raidAcc || 0) + dt;
      if (o.raidAcc >= RAID_HOUR_SEC) {
        o.raidAcc = 0;
        if (Math.random() < RAID_CHANCE_PER_HOUR) startRaid(o, o.systemId === inSys);
      }
    }
  }

  /* spawn a pirate probe; visible in-system, abstract off-system */
  function startRaid(o, visible) {
    if (visible) {
      var cfg = SF.CONFIG;
      var a = Math.random() * Math.PI * 2;
      var x = o.x + Math.cos(a) * PROBE_SPAWN_DIST;
      var y = o.y + Math.sin(a) * PROBE_SPAWN_DIST;
      var e = (window.SF && SF.Enemies) ?
        SF.Enemies.spawn('drone', x, y, 1, { encounter: 'outpost-raid', outpostId: o.id }) : null;
      if (!e) { abstractRaid(o); return; } // spawn failed (cap) — resolve abstractly
      e.adrift = true; // dead in the water; this phase steers it onto the outpost
      e.vx = 0; e.vy = 0;
      e.hp = PROBE_HP; e.maxHp = PROBE_HP;
      // own spec overlay: no contact-ram damage, shared drone spec untouched
      e.spec = Object.create(e.spec);
      e.spec.contact = 0;
      e.spec.fireInterval = 0;
      probes.push({ e: e, o: o, t: 0.5 });
      toast('☠ Pirate probe inbound on your mining outpost!');
      news('📻 Pirate probe detected closing on a private mining claim.');
      if (SF.Audio && SF.Audio.alert) SF.Audio.alert(); // sfx-hooks-v34b-retry: raid warning (was dead SF.Audio.warn)
    } else {
      abstractRaid(o);
    }
  }

  /* off-system (or spawn-failed) raids resolve instantly with a news echo */
  function abstractRaid(o) {
    if (o.turret) {
      news('📻 Outpost defense grid shredded a pirate probe. Claim intact.');
    } else if (o.hold > 0) {
      var steal = Math.max(2, Math.min(o.hold, Math.ceil(o.hold * 0.3)));
      o.hold -= steal;
      news('📻 Pirate probe raided a mining outpost — ' + steal + 't ore lost.');
      SF.Save.save();
    } else {
      news('📻 Pirate probe scanned a mining outpost hold — nothing worth stealing.');
    }
  }

  /* turret volley: friendly bolt aimed at the probe */
  function fireTurret(pr) {
    var o = pr.o;
    var dx = pr.e.x - o.x, dy = pr.e.y - o.y;
    var ang = Math.atan2(dy, dx || 1);
    if (window.SF && SF.Projectiles) {
      SF.Projectiles.spawn(o.x, o.y, ang + (Math.random() - 0.5) * 0.08,
        TURRET_SHOT_SPEED, TURRET_DMG, true, '#ffd27f', { radius: 4, life: 1.2 });
      if (SF.Particles) SF.Particles.burst(o.x, o.y, '#ffd27f', 3, 160, 0.2, 2);
    }
  }

  /* probe reached the outpost */
  function resolveRaid(pr, idx) {
    probes.splice(idx, 1);
    var o = pr.o;
    var li = SF.Enemies.list.indexOf(pr.e);
    if (li >= 0) SF.Enemies.list.splice(li, 1);
    if (window.SF && SF.Particles) SF.Particles.explosion(pr.e.x, pr.e.y, 0.9);
    if (o.turret) {
      // point-blank kill the turret should have made first: hull absorbs it
      o.hull = Math.max(0, (o.hull || TURRET_HULL) - 40);
      toast('🛡 Probe reached the outpost — turret destroyed it at point-blank. Hull ' +
        o.hull + '/' + TURRET_HULL + '.');
      news('📻 Pirate probe destroyed at a defended mining outpost. Hull holds.');
    } else {
      var steal = o.hold > 0 ? Math.max(2, Math.min(o.hold, Math.ceil(o.hold * 0.3))) : 0;
      o.hold -= steal;
      if (steal > 0) toast('☠ Pirate probe raided your outpost — stole ' + steal + 't ore!');
      else toast('☠ Pirate probe scanned your outpost hold — nothing to steal.');
      news('📻 Pirate probe raided a private mining claim' +
        (steal ? ' — ' + steal + 't ore lost.' : '.'));
    }
    SF.Save.save();
  }

  /* probe left the enemy list (turret kill, player kill, or system change) */
  function onProbeLost(pr) {
    var o = pr.o;
    if (o.systemId !== SF.Game.systemId) {
      // player jumped system mid-raid: the probe slips away, no toast spam
      return;
    }
    if (window.SF && SF.Particles) SF.Particles.explosion(pr.e.x, pr.e.y, 1.1);
    if (SF.Audio && SF.Audio.explosion) SF.Audio.explosion(true);
    if (o.turret) toast('🛡 Outpost turret shredded a pirate probe!');
    else toast('💥 Pirate probe destroyed before it reached your outpost!');
    news('📻 Pirate probe destroyed near a private mining claim.');
    SF.Save.save();
  }

  /* steer probes, run turrets, resolve arrivals — the deterministic sim */
  function raidProbeSim(dt) {
    for (var j = probes.length - 1; j >= 0; j--) {
      var pr = probes[j];
      if (SF.Enemies.list.indexOf(pr.e) < 0) {
        probes.splice(j, 1);
        onProbeLost(pr);
        continue;
      }
      var dx = pr.o.x - pr.e.x, dy = pr.o.y - pr.e.y;
      var d = Math.hypot(dx, dy) || 1;
      pr.e.vx = 0; pr.e.vy = 0; // adrift update must not fight the steering
      pr.e.x += dx / d * PROBE_SPEED * dt;
      pr.e.y += dy / d * PROBE_SPEED * dt;
      if (pr.o.turret && d < TURRET_RANGE) {
        pr.t -= dt;
        if (pr.t <= 0) { pr.t = TURRET_PERIOD; fireTurret(pr); }
      }
      if (d < PROBE_ARRIVE_DIST) resolveRaid(pr, j);
    }
  }

  /* ---------------- per-tick update (PLAYING only, chained on SF.Encounters.tick) ---------------- */

  function upTick(dt) {
    raidHourly(dt);
    raidProbeSim(dt);
    panelTick();
  }

  /* ---------------- runtime wiring (lazy: HUD loads after this file) ---------------- */

  var hooksInstalled = false;
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    if (SF.HUD && SF.HUD.hidePrompts && !SF.HUD.hidePrompts._outpostUpgrades) {
      var _hide = SF.HUD.hidePrompts;
      var wrappedH = function () { _hide.call(SF.HUD); hidePanel(); };
      wrappedH._outpostUpgrades = true;
      SF.HUD.hidePrompts = wrappedH;
    }
  }

  // chain onto the encounter tick, AFTER the mining-outposts hook (this IIFE
  // is appended later in the file, so the wrap nests outside it)
  if (window.SF && SF.Encounters && !SF.Encounters._outpostUpgradesHooked) {
    SF.Encounters._outpostUpgradesHooked = true;
    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      installHooks();
      upTick(dt);
    };
  }
})();
/* ============================================================
 * STARFALL — bounty-hunters-hunted phase (2026-10-20)
 *
 * SF.Hunters: notorious hunter ambushes. Karma has consequences:
 * when karma < -60, named hunter elites ambush the player in
 * Drift/Ember (never Solace).
 *
 *   Marrow the Collector  — Drift,   1,200cr bounty
 *   Cinder Jack            — Ember,   2,500cr bounty
 *   Void Marshal           — roaming Drift/Ember at karma < -90, 4,500cr
 *
 * Hunter AI: pure pursuit (never flees, never strafes — the flee check
 * in the base update is neutralized for hunters by a save/restore wrap
 * on SF.Enemies.update), closes on the player at elite speed, fires
 * flak bursts up close (<480u: 9 pellets, SF.WEAPONS.flak ballistics)
 * and EMP bolts at range (SF.WEAPONS.emp ballistics, 3s stun). Hunter
 * EMP bolts are intercepted in the hunter tick before collisions() and
 * apply a dead-stick stun to the player (muted input in a SF.Player.update
 * wrap) with the same treatment the base game gives stunned enemies.
 *
 * Ambush cadence: one 60s roll while PLAYING, chance 25% at -60..-69
 * and +25% of that per extra -10 karma (chanceFor). Max one hunter at
 * a time. Spawn posts a hunter-warning echo on the news wire
 * (SF.News) + a warning toast.
 *
 * Killing a hunter: +5 karma, +10 standing with the local faction,
 * direct credit payout scaled by tier. (The base kill() also fires its
 * normal pirate-kill consequences — Compact +2, karma +1 — on top, the
 * same additive pattern the elite system uses.)
 *
 * Docking despawns hunters (they wait outside: the ambush timer is
 * shortened to 15s on undock while karma stays infamous). System
 * jumps clear hunters via the SF.Encounters.reset chain.
 *
 * Purely runtime, save-neutral: no new save fields, no SF.SAVE_VERSION
 * bump. Integration is wraps-only (never edits): SF.Encounters.tick /
 * .reset, SF.Enemies.kill / .draw / .update, SF.Station.dock / .undock
 * (lazy), SF.Player.update (lazy).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.Hunters && SF.Hunters._installed) return; // no double install

  /* ---------------- tuning ---------------- */
  var KARMA_GATE = -60;    // hunters start hunting below this
  var MARSHAL_GATE = -90;  // Void Marshal roams below this
  var BASE_CHANCE = 0.25;  // ambush chance per minute at -60..-69
  var STEP_BONUS = 0.25;   // each further -10 karma adds +25% of base
  var SPAWN_PERIOD = 60;   // seconds between ambush rolls
  var FLAK_RANGE = 480;    // flak bursts inside this, EMP bolts outside
  var FIRE_RANGE = 950;

  var DEFS = {
    marrow: {
      id: 'marrow', name: 'Marrow the Collector', systems: ['drift'],
      hpMul: 2.0, speedMul: 2.0, bounty: 1200, tint: '#c56bff',
      warn: 'Marrow the Collector has put a price on your head!'
    },
    cinder: {
      id: 'cinder', name: 'Cinder Jack', systems: ['ember'],
      hpMul: 3.0, speedMul: 2.2, bounty: 2500, tint: '#ff7a2a',
      warn: 'Cinder Jack is burning toward your position!'
    },
    marshal: {
      id: 'marshal', name: 'Void Marshal', systems: ['drift', 'ember'],
      hpMul: 4.5, speedMul: 2.4, bounty: 4500, tint: '#8affff', roam: true,
      warn: 'The Void Marshal itself has come to collect you.'
    }
  };

  var SYSTEM_FACTION = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }
  function karma() {
    try { return (window.SF && SF.Factions) ? SF.Factions.karma() : 0; }
    catch (e) { return 0; }
  }

  /* ---------------- runtime state (never saved) ---------------- */
  var activeHunter = null;   // the live hunter entity, if any
  var hunterTimer = SPAWN_PERIOD;
  var playerEmpStun = 0;     // seconds of dead-stick remaining

  /* Ambush chance per minute for a karma value. Strictly below -60:
   * 25% base at -60..-69, +25% of base per further -10. */
  function chanceFor(k) {
    if (!(k < KARMA_GATE)) return 0;
    var steps = Math.floor((KARMA_GATE - k) / 10);
    return BASE_CHANCE * (1 + STEP_BONUS * steps);
  }

  function tierFor(sysId, k) {
    if (sysId === 'solace') return null; // never Solace
    if (k < MARSHAL_GATE) return DEFS.marshal; // roaming terror
    if (sysId === 'drift') return DEFS.marrow;
    if (sysId === 'ember') return DEFS.cinder;
    return null;
  }

  /* ---------------- spawning ---------------- */

  function spawnHunter(def) {
    var sysId = SF.Game.systemId;
    var p = SF.Player, cfg = SF.CONFIG;
    var sysMul = (SF.SYSTEM_BY_ID[sysId] ? SF.SYSTEM_BY_ID[sysId].enemyMul : 1);
    var a = Math.random() * Math.PI * 2;
    var d = 650 + Math.random() * 250;
    var x = p.x + Math.cos(a) * d;
    var y = p.y + Math.sin(a) * d;
    var e = SF.Enemies.spawn('gunship', x, y, sysMul * def.hpMul, {
      encounter: 'hunter', hunterId: def.id, hunterName: def.name
    });
    if (!e) return null;
    e.hunter = true;
    e.hunterId = def.id;      // SF.Enemies.spawn only copies known opts fields
    e.hunterName = def.name;  // ...so the hunter identity is stamped here
    e.hunterDef = def;
    e.speedMul = def.speedMul;
    e.hunterFireT = 1.2 + Math.random() * 0.8;
    e.fireInterval = 9999; e.fireTimer = 9999; // hunter ordnance handled below
    e.state = 'chase';
    activeHunter = e;
    toast('⚠ ' + def.warn);
    news('🚨 GALACTIC WIRE: notorious hunter ' + def.name +
      ' is hunting a pilot with a ' + (-karma()) + '-karma record in ' +
      sysName(sysId) + '. Bounty hunters: stand clear.');
    if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny();
    return e;
  }

  function trySpawn(sysId) {
    // early-game-difficulty-1: hunters never hunt a rookie. (Already
    // doubly gated today — karma < -60 required and tierFor() returns
    // null for Solace — this is the structural belt-and-braces so a
    // future karma/territory retune cannot reopen the early game.)
    if (window.SF && SF.Enemies && SF.Enemies.rookieFactor &&
        SF.Enemies.rookieFactor(sysId).active) return null;
    var k = karma();
    if (!(k < KARMA_GATE)) return null;
    if (activeHunter) return null;
    var def = tierFor(sysId, k);
    if (!def) return null;
    if (Math.random() >= chanceFor(k)) return null;
    return spawnHunter(def);
  }

  /* ---------------- hunter ordnance ---------------- */

  function fireFlak(e, nx, ny) {
    // SF.WEAPONS.flak ballistics: 9 pellets, 0.55 spread, 520 speed
    var w = (window.SF && SF.WEAPONS && SF.WEAPONS.flak) ||
      { damage: 5, projectileSpeed: 520, pellets: 9, spread: 0.55 };
    var base = Math.atan2(ny, nx);
    var dmg = w.damage * (e.dmgMul || 1);
    for (var i = 0; i < (w.pellets || 9); i++) {
      var a = base + (Math.random() - 0.5) * 2 * (w.spread || 0.55);
      var pr = SF.Projectiles.spawn(e.x, e.y, a, w.projectileSpeed, dmg,
        false, '#ffd98a', { radius: 3, life: 1.1 });
      if (pr) pr.hunterFired = true;
    }
    if (window.SF && SF.Audio && SF.Audio.enemyLaser) SF.Audio.enemyLaser();
  }

  function fireEmp(e, nx, ny) {
    // SF.WEAPONS.emp ballistics: 600 speed, 18 dmg, 3s stun
    var w = (window.SF && SF.WEAPONS && SF.WEAPONS.emp) ||
      { damage: 18, projectileSpeed: 600, emp: 3.0 };
    var a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 0.08;
    var pr = SF.Projectiles.spawn(e.x, e.y, a, w.projectileSpeed,
      w.damage * (e.dmgMul || 1), false, '#d28aff',
      { kind: 'emp', emp: w.emp || 3.0, radius: 4, life: 2.6 });
    if (pr) { pr.hunterFired = true; pr.hunterEmp = true; }
    if (window.SF && SF.Audio && SF.Audio.emp) SF.Audio.emp();
  }

  /* Hunter EMP bolts are intercepted here (this tick runs before the
   * base collisions()) so the stun lands exactly once with full context. */
  function empTick() {
    var p = SF.Player, pool = SF.Projectiles.pool;
    for (var i = 0; i < pool.length; i++) {
      var pr = pool[i];
      if (!pr.active || !pr.hunterEmp) continue;
      var dx = pr.x - p.x, dy = pr.y - p.y, rr = pr.radius + p.radius;
      if (dx * dx + dy * dy < rr * rr) {
        pr.active = false;
        if (!p.alive) continue;
        p.takeDamage(pr.dmg);
        playerEmpStun = Math.max(playerEmpStun, pr.emp || 3);
        toast('⚡ EMP HIT — systems rebooting!');
        if (window.SF && SF.Particles)
          SF.Particles.burst(p.x, p.y, '#d28aff', 14, 220, 0.5, 3);
        if (window.SF && SF.Audio && SF.Audio.emp) SF.Audio.emp();
        if (window.SF && SF.FX) SF.FX.shake(5);
      }
    }
  }

  /* ---------------- per-frame hunter AI ---------------- */

  function updateHunter(e, dt) {
    var p = SF.Player;
    var dx = p.x - e.x, dy = p.y - e.y;
    var dist = Math.hypot(dx, dy) || 1;
    // pure pursuit: the base update steers on e.state, so pin it to chase.
    // (speedMul was set at spawn; the base update moves the hunter.)
    e.state = 'chase';
    e.angle = Math.atan2(dy, dx);
    // ordnance: flak up close, EMP at range
    e.hunterFireT -= dt;
    if (e.hunterFireT <= 0 && dist < FIRE_RANGE && p.alive) {
      e.hunterFireT = 1.9 + Math.random() * 0.7;
      var nx = dx / dist, ny = dy / dist;
      if (dist < FLAK_RANGE) fireFlak(e, nx, ny);
      else fireEmp(e, nx, ny);
    }
  }

  function hunterTick(dt) {
    installHooks();
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
    var sysId = SF.Game.systemId;
    if (activeHunter && SF.Enemies.list.indexOf(activeHunter) < 0) activeHunter = null;
    if (activeHunter) {
      updateHunter(activeHunter, dt);
    } else {
      hunterTimer -= dt;
      if (hunterTimer <= 0) {
        hunterTimer = SPAWN_PERIOD;
        trySpawn(sysId);
      }
    }
    empTick();
  }

  function despawnHunters(why) {
    var list = SF.Enemies.list;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].hunter) list.splice(i, 1);
    }
    if (activeHunter) {
      activeHunter = null;
      if (why === 'docked')
        toast('The hunters break off — they\'ll be waiting when you undock.');
    }
  }

  /* ---------------- kill rewards ---------------- */

  function onHunterKill(e) {
    var def = (e && e.hunterDef) || DEFS[(e && e.hunterId)] || {};
    var sysId = SF.Game.systemId;
    var localF = SYSTEM_FACTION[sysId];
    var bounty = def.bounty || 0;
    SF.Player.credits += bounty;
    if (window.SF && SF.Factions) {
      SF.Factions.shiftKarma(5);
      if (localF) SF.Factions.shift(localF, 10);
    }
    var fname = (localF && window.SF && SF.FACTION_BY_ID[localF])
      ? SF.FACTION_BY_ID[localF].name : 'the locals';
    toast('☠ ' + (e.hunterName || 'Hunter') + ' destroyed! +' + bounty +
      'cr hunter bounty · +5 karma · ' + fname + ' +10 standing');
    news('☠ Notorious hunter ' + (e.hunterName || 'unknown') +
      ' destroyed in ' + sysName(sysId) + ' — ' + bounty + 'cr bounty paid.');
    if (window.SF && SF.Audio && SF.Audio.credit) SF.Audio.credit();
    if (activeHunter === e) activeHunter = null;
    hunterTimer = SPAWN_PERIOD; // cooldown before the next ambush roll
  }

  /* ---------------- world-space hunter tags ---------------- */

  function drawHunterTags(ctx) {
    var list = SF.Enemies.list;
    var pulse = 0.5 + 0.3 * Math.sin(performance.now() / 180);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !e.hunter) continue;
      var tint = (e.hunterDef && e.hunterDef.tint) || '#ff3b3b';
      ctx.save();
      ctx.strokeStyle = tint;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = tint;
      ctx.fillText('☠ ' + (e.hunterName || 'HUNTER'), e.x, e.y - e.radius - 14);
      ctx.restore();
    }
  }

  /* ---------------- public API + test hooks ---------------- */

  var H = {
    _installed: true,
    DEFS: DEFS,
    TUNE: { KARMA_GATE: KARMA_GATE, MARSHAL_GATE: MARSHAL_GATE,
            BASE_CHANCE: BASE_CHANCE, STEP_BONUS: STEP_BONUS,
            SPAWN_PERIOD: SPAWN_PERIOD },
    chanceFor: chanceFor,
    active: function () { return activeHunter; },
    /* force-spawn for tests/smoke: defId overrides the karma/system pick */
    testSpawn: function (defId) {
      installHooks();
      var def = (defId && DEFS[defId]) || tierFor(SF.Game.systemId, karma());
      if (!def) return null;
      if (activeHunter) despawnHunters('test');
      return spawnHunter(def);
    },
    despawn: function () { despawnHunters('test'); },
    testEmpStun: function () { return playerEmpStun; },
    testState: function () {
      return {
        active: !!activeHunter,
        name: activeHunter ? activeHunter.hunterName : null,
        x: activeHunter ? Math.round(activeHunter.x) : null,
        y: activeHunter ? Math.round(activeHunter.y) : null,
        timer: Math.round(hunterTimer * 10) / 10,
        karma: karma()
      };
    }
  };

  SF.Hunters = H;

  /* ---------------- runtime wiring (wraps, never edits) ---------------- */

  var hooksInstalled = false;
  function installHooks() {
    if (hooksInstalled) return;
    var ok = true;
    // dock/undock live in station.js, which loads AFTER this file
    if (window.SF && SF.Station) {
      if (SF.Station.dock && !SF.Station.dock._hunters) {
        var _d = SF.Station.dock;
        var w = function () {
          var r = _d.apply(this, arguments);
          try { despawnHunters('docked'); } catch (e) {}
          return r;
        };
        w._hunters = true;
        SF.Station.dock = w;
      }
      if (SF.Station.undock && !SF.Station.undock._hunters) {
        var _u = SF.Station.undock;
        var wu = function () {
          var r = _u.apply(this, arguments);
          try {
            // they wait outside: short fuse before the next ambush roll
            if (karma() < KARMA_GATE) {
              hunterTimer = Math.min(hunterTimer, 15);
              toast('⚠ The hunters are still out there…');
            }
          } catch (e) {}
          return r;
        };
        wu._hunters = true;
        SF.Station.undock = wu;
      }
    } else ok = false;
    // player EMP stun: mute thrust + fire while the reboot runs
    if (window.SF && SF.Player && SF.Player.update && !SF.Player.update._hunters) {
      var _pu = SF.Player.update;
      var wpu = function (dt, input) {
        if (playerEmpStun > 0) {
          playerEmpStun -= dt;
          input = { mx: 0, my: 0, firing: false, aimActive: false, aimAngle: 0 };
        }
        return _pu.call(this, dt, input);
      };
      wpu._hunters = true;
      SF.Player.update = wpu;
    }
    if (ok) hooksInstalled = true;
  }

  // ambush scheduler + hunter AI ride the encounter tick
  if (window.SF && SF.Encounters && !SF.Encounters._huntersHooked) {
    SF.Encounters._huntersHooked = true;
    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      hunterTick(dt);
    };
    var _reset = SF.Encounters.reset;
    SF.Encounters.reset = function () {
      _reset.call(SF.Encounters);
      despawnHunters('system-change');
      hunterTimer = SPAWN_PERIOD;
      playerEmpStun = 0;
    };
  }

  // hunter kill rewards (chains after the base pirate-kill consequences)
  if (window.SF && SF.Enemies && !SF.Enemies.kill._hunters) {
    var _kill = SF.Enemies.kill;
    var _wkill = function (e) {
      var isHunter = !!(e && e.hunter);
      var r = _kill.apply(this, arguments);
      if (isHunter) { try { onHunterKill(e); } catch (err) {} }
      return r;
    };
    _wkill._hunters = true;
    SF.Enemies.kill = _wkill;
  }

  // hunter name tags + warning rings
  if (window.SF && SF.Enemies && SF.Enemies.draw && !SF.Enemies.draw._hunters) {
    var _draw = SF.Enemies.draw;
    var _wdraw = function (ctx) {
      _draw.call(SF.Enemies, ctx);
      try { drawHunterTags(ctx); } catch (e) {}
    };
    _wdraw._hunters = true;
    SF.Enemies.draw = _wdraw;
  }

  // hunters never flee: the base update flips crippled enemies to 'flee'.
  // Park their hp above the flee line for the base pass, then restore it.
  // (Damage lands via collisions(), outside this wrap, so the restore is safe.)
  if (window.SF && SF.Enemies && SF.Enemies.update && !SF.Enemies.update._hunters) {
    var _eu = SF.Enemies.update;
    var _weu = function (dt, player, worldSize) {
      var saved = null;
      var line = SF.CONFIG.fleeHpFrac;
      for (var i = 0; i < SF.Enemies.list.length; i++) {
        var e = SF.Enemies.list[i];
        if (e && e.hunter && e.hp < e.maxHp * line) {
          if (!saved) saved = [];
          saved.push([e, e.hp]);
          e.hp = e.maxHp * line;
        }
      }
      var r = _eu.call(this, dt, player, worldSize);
      if (saved) for (var j = 0; j < saved.length; j++) saved[j][0].hp = saved[j][1];
      return r;
    };
    _weu._hunters = true;
    SF.Enemies.update = _weu;
  }
})();
/* ============================================================
 * STARFALL — elite-bounty-contracts phase (2026-10-20)
 *
 * SF.EliteContracts: rotating named-elite hunt contracts layered on the
 * existing bounty board (SF.Bounty, gameplay-depth section, same file —
 * never refactored, only wrapped).
 *
 *   3 concurrent contracts, one per system (Solace=Fast, Drift=Bulwark,
 *   Ember=Swarmlord). Each names a specific elite with a generated
 *   callsign (SF.Elites.pickName, enemy-elites variants).
 *
 *   ACCEPT from the bounty-board section (added by a renderBoard wrap).
 *   The target spawns in its home system while the contract is active
 *   (waypoint + scope toast, mirroring SF.Bounty.spawnCheck).
 *
 *   KILL: the named elite pays its normal elite reward (base bounty roll
 *   x variant creditMul, delivered as a credit pickup at the wreck) and
 *   the contract pays the EXACT same amount again as a direct credit
 *   bonus — 2x total — plus +8 standing with the local faction (on top
 *   of the normal +4 elite standing and the usual pirate-kill
 *   consequences). An elite killed without its contract active pays only
 *   the normal elite reward. Swarmlord death-adds carry no contractId
 *   and never pay.
 *
 *   CLUE TRAIL: every 90s of PLAYING per active contract, the news
 *   ticker (runtime SF.News.push only, no news.js edits) updates the
 *   target's last-seen area.
 *
 *   ROTATION: each contract accrues PLAYING time; at 30 min it is
 *   replaced with a fresh target — no penalty. Fulfilled contracts are
 *   replaced on the next tick.
 *
 * Save-neutral: contracts ride the existing bounty blob
 * (SF.Player.bountyState._contracts) with defensive reads — no
 * SF.SAVE_VERSION bump, no migration.
 *
 * Integration is runtime-only from this file, in the style of the
 * encounter-variety / mining-outposts phases: SF.Encounters.tick
 * chained, SF.Enemies.kill wrapped (kill-side-effects only, never
 * edited), SF.Bounty.renderBoard wrapped to append the contracts
 * section. Nothing in this file touches the live tree; the safe-room
 * audit copies the changed file into a combined tree and runs
 * smoke.mjs --base <dir>.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.EliteContracts && SF.EliteContracts._installed) return; // no double install

  /* ---------------- tuning ---------------- */
  var ROTATE_SEC = 1800;   // 30 min of PLAYING time per contract, then replaced
  var CLUE_SEC = 90;       // clue-trail news echo cadence per active contract
  var BONUS_STANDING = 8;  // contract bonus standing with the local faction
  var SYSTEMS = ['solace', 'drift', 'ember'];
  var SYSTEM_VARIANT = { solace: 'fast', drift: 'bulwark', ember: 'swarmlord' };
  var SYSTEM_FACTION = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  var LAST_SEEN_AREAS = {
    solace: ['the inner shipping lanes', 'the pale ice belt',
      'a patrol waypoint near Solace Prime', 'the derelict yards'],
    drift: ['the freeport approaches', 'a dust-choked gully',
      "the smuggler's cut", 'the shattered moon'],
    ember: ['the ash fields', 'a lava-lit rift', 'the scorched belt', 'the Ember Gate']
  };

  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }
  function variantName(v) {
    return (window.SF && SF.ELITE_VARIANTS && SF.ELITE_VARIANTS[v]) ? SF.ELITE_VARIANTS[v].name : v;
  }
  function spawnNear(typeId, mul, opts, minD, maxD) {
    var p = SF.Player, cfg = SF.CONFIG;
    var a = Math.random() * Math.PI * 2;
    var d = (minD || 600) + Math.random() * ((maxD || 950) - (minD || 600));
    var x = p.x + Math.cos(a) * d;
    var y = p.y + Math.sin(a) * d;
    return SF.Enemies.spawn(typeId, x, y, mul, opts || {});
  }

  /* ---------------- persistent blob (defensive, save-neutral) ---------------- */

  function blob() {
    var st = (window.SF && SF.Player) ? SF.Player.bountyState : null;
    if (!st) return { contracts: [] }; // pre-game: read-only empty view
    var c = st._contracts;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      c = { contracts: [] };
      st._contracts = c;
    }
    if (!Array.isArray(c.contracts)) c.contracts = [];
    // normalize entries (corrupt/old blobs stay loadable)
    for (var i = 0; i < c.contracts.length; i++) {
      var e = c.contracts[i];
      if (!e || typeof e !== 'object' || SYSTEMS.indexOf(e.system) < 0) {
        c.contracts.splice(i, 1); i--; continue;
      }
      if (e.variant !== SYSTEM_VARIANT[e.system]) e.variant = SYSTEM_VARIANT[e.system];
      if (typeof e.callsign !== 'string' || !e.callsign)
        e.callsign = variantName(e.variant) + ' Unknown';
      if (e.state !== 'offer' && e.state !== 'active' && e.state !== 'done') e.state = 'offer';
      e.playT = Math.max(0, +e.playT || 0);
      e.clueT = Math.max(0, +e.clueT || 0);
      if (typeof e.lastSeen !== 'string') e.lastSeen = 'somewhere in ' + sysName(e.system);
    }
    return c;
  }

  function rollContract(systemId) {
    var variant = SYSTEM_VARIANT[systemId];
    var callsign = (window.SF && SF.Elites) ? SF.Elites.pickName(variant) : variantName(variant);
    var areas = LAST_SEEN_AREAS[systemId] || ['deep space'];
    return {
      id: 'ec' + Date.now().toString(36) + rint(100, 999),
      system: systemId,
      variant: variant,
      callsign: callsign,
      state: 'offer',
      playT: 0,
      clueT: 0,
      lastSeen: areas[rint(0, areas.length - 1)]
    };
  }

  /* keep exactly 3 contracts, one per system */
  function ensureContracts() {
    var c = blob().contracts, i, j, found;
    for (i = 0; i < SYSTEMS.length; i++) {
      found = false;
      for (j = 0; j < c.length; j++) {
        if (c[j].system === SYSTEMS[i]) { found = true; break; }
      }
      if (!found) c.push(rollContract(SYSTEMS[i]));
    }
    // drop any extras (shouldn't happen, but keep the invariant)
    var seen = {};
    for (i = c.length - 1; i >= 0; i--) {
      if (seen[c[i].system]) c.splice(i, 1);
      else seen[c[i].system] = true;
    }
  }

  function findContract(id) {
    var c = blob().contracts;
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  }

  /* ---------------- contract lifecycle ---------------- */

  function replaceContract(ct, why) {
    var fresh = rollContract(ct.system);
    var c = blob().contracts;
    var i = c.indexOf(ct);
    if (i >= 0) c[i] = fresh; else c.push(fresh);
    if (why === 'expired') {
      news('\uD83D\uDCF0 Elite contract expired — new target posted: ' + fresh.callsign +
        ' (' + variantName(fresh.variant) + ' elite), wanted in ' + sysName(fresh.system) + '.');
      toast('\uD83D\uDCF0 An elite contract expired — a fresh target was posted.');
    } else {
      news('\uD83D\uDCF0 New elite contract posted: ' + fresh.callsign +
        ' (' + variantName(fresh.variant) + ' elite), wanted in ' + sysName(fresh.system) + '.');
    }
    SF.Save.save();
  }

  /* clue trail: update the target's last-seen via the news ticker */
  function clue(ct) {
    ct.clueT = 0;
    var areas = LAST_SEEN_AREAS[ct.system] || ['deep space'];
    var area = areas[rint(0, areas.length - 1)];
    if (area === ct.lastSeen && areas.length > 1) {
      area = areas[(areas.indexOf(area) + 1) % areas.length];
    }
    ct.lastSeen = area;
    news('\uD83D\uDCF0 WANTED: ' + ct.callsign + ' (' + variantName(ct.variant) + ' elite) — last seen ' +
      area + ' in ' + sysName(ct.system) + '.');
  }

  /* spawn the named target when the player is in its home system */
  function spawnCheck() {
    var c = blob().contracts;
    for (var i = 0; i < c.length; i++) {
      var ct = c[i];
      if (ct.state !== 'active' || SF.Game.systemId !== ct.system) continue;
      var live = SF.Enemies.list.some(function (e) { return e.contractId === ct.id; });
      if (live) continue;
      var mul = (SF.SYSTEM_BY_ID[ct.system] ? SF.SYSTEM_BY_ID[ct.system].enemyMul : 1);
      var e = spawnNear('gunship', mul, { elite: ct.variant, encounter: 'elite-contract' }, 600, 850);
      if (e) {
        e.contractId = ct.id;          // SF.Enemies.spawn only copies known opts fields
        e.eliteName = ct.callsign;     // the kill banner shows the contract name
        toast('\uD83C\uDFAF Contract target on scope: ' + ct.callsign + '!');
        if (window.SF && SF.Audio && SF.Audio.warn) SF.Audio.warn();
      }
    }
  }

  /* The contract kill bonus: the EXACT normal elite payout again, direct.
   * `baseBounty` is the credit-pickup amount the base kill() rolled for
   * this elite (captured by intercepting SF.Pickups.spawnCredits during
   * the wrapped kill), so the player nets exactly 2x on collection. */
  function contractKillBonus(ct, baseBounty) {
    ct.state = 'done';
    var bonus = Math.max(0, Math.round(baseBounty || 0));
    if (bonus > 0) SF.Player.credits += bonus;
    var localF = SYSTEM_FACTION[SF.Game.systemId];
    if (window.SF && SF.Factions && localF) SF.Factions.shift(localF, BONUS_STANDING);
    var fname = (localF && window.SF && SF.FACTION_BY_ID[localF])
      ? SF.FACTION_BY_ID[localF].name : 'the locals';
    toast('\uD83C\uDFAF CONTRACT FULFILLED — ' + ct.callsign + '! +' + bonus + 'cr bonus · ' +
      fname + ' +' + BONUS_STANDING + ' standing');
    news('\uD83C\uDFAF Elite contract fulfilled: ' + ct.callsign + ' (' + variantName(ct.variant) +
      ') destroyed in ' + sysName(ct.system) + ' — bonus ' + bonus + 'cr paid (2x total).');
    if (window.SF && SF.Audio && SF.Audio.credit) SF.Audio.credit();
    if (SF.Game.waypoint && SF.Game.waypoint.contractId === ct.id) SF.Game.waypoint = null;
    SF.Save.save();
  }

  /* ---------------- per-tick update (PLAYING only, chained) ---------------- */

  function ctTick(dt) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING' || !SF.Player) return;
    ensureContracts();
    var c = blob().contracts;
    for (var i = 0; i < c.length; i++) {
      var ct = c[i];
      ct.playT += dt;
      if (ct.state === 'done') { replaceContract(ct, 'done'); continue; }
      if (ct.playT >= ROTATE_SEC) { replaceContract(ct, 'expired'); continue; }
      if (ct.state === 'active') {
        ct.clueT += dt;
        if (ct.clueT >= CLUE_SEC) clue(ct);
      }
    }
    spawnCheck();
  }

  /* ---------------- bounty-board section (renderBoard wrap) ---------------- */

  function renderContracts(body) {
    var h = document.createElement('div'); h.className = 'store-head';
    h.textContent = '\uD83C\uDFAF ELITE CONTRACTS'; body.appendChild(h);
    var list = blob().contracts;
    var self = SF.EliteContracts;
    list.forEach(function (ct) {
      var row = document.createElement('div');
      row.className = 'store-row';
      var fd = SF.FACTION_BY_ID[SYSTEM_FACTION[ct.system]];
      var status = ct.state === 'offer'
        ? 'Status: <b>open</b>'
        : (ct.state === 'active'
          ? 'Status: <b>accepted — at large</b>'
          : '<b style="color:#3ddc5f">FULFILLED</b>');
      row.innerHTML =
        '<div class="store-info"><div><div class="store-name">\uD83C\uDFAF ' + ct.callsign + '</div>' +
        '<div class="store-desc">' + variantName(ct.variant) + ' elite · Wanted in: <b>' +
        sysName(ct.system) + '</b>' +
        '<br>Last seen: <b>' + ct.lastSeen + '</b>' +
        '<br>Bonus: <b>2× base bounty</b> + <span style="color:' + fd.color + '">' +
        fd.name + ' +' + BONUS_STANDING + ' standing</span><br>' + status + '</div></div></div>' +
        '<button class="btn store-btn"' + (ct.state === 'offer' ? '' : ' disabled') + '>' +
        (ct.state === 'offer' ? 'ACCEPT' : '—') + '</button>';
      if (ct.state === 'offer') {
        (function (id, btn) {
          btn.addEventListener('click', function () {
            if (self.accept(id)) SF.Station.renderStore();
          });
        })(ct.id, row.querySelector('button'));
      }
      body.appendChild(row);
    });
  }

  /* ---------------- public API + test hooks ---------------- */

  var EC = {
    _installed: true,
    ROTATE_SEC: ROTATE_SEC, CLUE_SEC: CLUE_SEC, BONUS_STANDING: BONUS_STANDING,
    SYSTEM_VARIANT: SYSTEM_VARIANT,

    list: function () { return blob().contracts.slice(); },
    get: function (id) { return findContract(id); },

    accept: function (id) {
      var ct = findContract(id);
      if (!ct || ct.state !== 'offer') return false;
      ct.state = 'active';
      SF.Game.waypoint = {
        systemId: ct.system, x: 2100, y: 2100,
        label: '\uD83C\uDFAF ' + ct.callsign, contractId: ct.id
      };
      toast('\uD83C\uDFAF Contract accepted: ' + ct.callsign + ' — wanted in ' + sysName(ct.system) + '.');
      news('\uD83D\uDCF0 Elite contract accepted: ' + ct.callsign + ' (' + variantName(ct.variant) +
        ' elite) wanted in ' + sysName(ct.system) + '.');
      if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
      SF.Save.save();
      return true;
    },

    /* test hook: force-spawn this contract's named target now */
    testSpawn: function (id) {
      var ct = findContract(id);
      if (!ct) return null;
      var e = spawnNear('gunship', 1, { elite: ct.variant, encounter: 'elite-contract' }, 500, 700);
      if (e) { e.contractId = ct.id; e.eliteName = ct.callsign; }
      return e;
    },

    /* test hook: push every contract to rotation age (next tick replaces) */
    forceRotate: function () {
      var c = blob().contracts;
      for (var i = 0; i < c.length; i++) c[i].playT = ROTATE_SEC;
      return c.length;
    },

    /* test hook: trigger a clue echo for one contract now */
    forceClue: function (id) {
      var ct = findContract(id);
      if (!ct) return null;
      ct.clueT = CLUE_SEC;
      clue(ct);
      return ct.lastSeen;
    },

    testState: function () {
      var c = blob().contracts;
      return {
        count: c.length,
        systems: c.map(function (x) { return x.system; }),
        states: c.map(function (x) { return x.state; }),
        callsigns: c.map(function (x) { return x.callsign; }),
        liveTargets: SF.Enemies.list.filter(function (e) { return !!e.contractId; }).length
      };
    }
  };

  SF.EliteContracts = EC;

  /* ---------------- runtime wiring (wraps, never edits) ---------------- */

  // contracts section rides the existing bounty board
  if (window.SF && SF.Bounty && !SF.Bounty.renderBoard._eliteContracts) {
    var _rb = SF.Bounty.renderBoard;
    var wrb = function (body) {
      _rb.call(SF.Bounty, body);
      try { renderContracts(body); } catch (err) {}
    };
    wrb._eliteContracts = true;
    SF.Bounty.renderBoard = wrb;
  }

  // contract lifecycle + target spawning ride the encounter tick
  if (window.SF && SF.Encounters && !SF.Encounters._eliteContractsHooked) {
    SF.Encounters._eliteContractsHooked = true;
    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      ctTick(dt);
    };
  }

  // Contract kill bonus: capture the exact base-bounty pickup the base
  // kill() rolls, then pay it again as a direct bonus (2x total).
  if (window.SF && SF.Enemies && !SF.Enemies.kill._eliteContracts) {
    var _kill = SF.Enemies.kill;
    var wkill = function (e) {
      var ct = (e && e.contractId) ? findContract(e.contractId) : null;
      var active = !!(ct && ct.state === 'active');
      var captured = 0, _sc = null;
      if (active && window.SF && SF.Pickups && SF.Pickups.spawnCredits) {
        _sc = SF.Pickups.spawnCredits;
        SF.Pickups.spawnCredits = function (x, y, amount) {
          captured += (amount || 0);
          return _sc.call(SF.Pickups, x, y, amount);
        };
      }
      var r;
      try { r = _kill.apply(this, arguments); }
      finally { if (_sc) SF.Pickups.spawnCredits = _sc; }
      if (active) { try { contractKillBonus(ct, captured); } catch (err) {} }
      return r;
    };
    wkill._eliteContracts = true;
    SF.Enemies.kill = wkill;
  }
})();
/* ============================================================
 * STARFALL — killstreak-voice-wiring phase (2026-10-20)
 *
 * SF.KillstreakVoice: wires voice-pack-5's killstreak + elite-ambush
 * lines into gameplay. Wraps-only integration (never edits any other
 * module or this file's existing phases), matching the style of the
 * other phases in this file.
 *
 * Triggers — every call is guarded:
 *     if (SF.Audio && SF.Audio.voice) SF.Audio.voice('<id>')
 *   killstreak_01..05 — player kill streak hits 2/3/5/8/10 kills.
 *     Read from the same SF.Enemies.kill calls the combat feed hooks
 *     (hud.js SF.CombatFeed); boss kills route to SF.Bosses.onKill and
 *     never reach kill(), so they never count. A per-line 60s cooldown
 *     gate keeps any single line from spamming while a hot streak can
 *     still escalate its callouts.
 *   killstreak_06 — an active streak (>= 2) is broken by hull damage
 *     (shield-only absorbs don't count).
 *   ambushelite_01 — bounty-hunters-hunted ambush: a hunter elite
 *     spawns (SF.Enemies.spawn opts.encounter === 'hunter'), the same
 *     spawn the phase's ambush toast fires from.
 *   ambushelite_02 — kamikaze telegraph start: the pattern phase flips
 *     to 'telegraph' on the first SF.Enemies.update tick after spawn;
 *     each kamikaze is announced once (per-entity flag).
 *   ambushelite_03 — swarmlord elite spawn (spawned e.elite === 'swarmlord').
 *   ambushelite_04 — pirate 'ambush' encounter run. Note: the codebase
 *     has no wolfpack entity; the pirate-pack ambush encounter (the
 *     "Pirate ambush! Hostiles on all scopes!" converge) is the
 *     matching event for the "Pirate wolfpack converging" line.
 *
 * Save-neutral: all state is runtime-only; no SF.SAVE_VERSION bump.
 * New SF.* surface: SF.KillstreakVoice only (_installed + testState /
 * testReset debug hooks for smoke tests). No signature changes.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.KillstreakVoice && SF.KillstreakVoice._installed) return; // no double install

  /* ---- tuning ---- */
  var MILESTONES = { // streak count -> voice id (exact ids, VOICE-MANIFEST-5)
    2: 'killstreak_01', 3: 'killstreak_02', 5: 'killstreak_03',
    8: 'killstreak_04', 10: 'killstreak_05'
  };
  var KS_GATE_S = 60;  // per-line cooldown: a line can't spam more than once per 60s
  var STREAK_TIMEOUT_S = 30; // no kill for this long: streak fizzles, silent
  var BROKEN_ID = 'killstreak_06';

  /* ---- runtime state (never saved) ---- */
  var streak = 0;        // consecutive player-caused kills
  var lastKillT = 0;      // s, for the fizzle timeout
  var lastKsVoiceT = {}; // voice id -> s of last play (per-line 60s gate)

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  /* Guarded voice call — exactly the contract the brief specifies. */
  function voice(id) {
    try {
      if (window.SF && SF.Audio && SF.Audio.voice) SF.Audio.voice(id);
    } catch (e) { /* audio is best-effort; never break gameplay */ }
  }

  /* Killstreak series voice: per-line 60s gate so no single line spams,
   * while a hot streak can still escalate its callouts (2 -> 3 -> 5 ...). */
  function ksVoice(id) {
    var t = nowS();
    if (t - (lastKsVoiceT[id] || -1e9) < KS_GATE_S) return false;
    lastKsVoiceT[id] = t;
    voice(id);
    return true;
  }

  function onPlayerKill() {
    var t = nowS();
    if (t - lastKillT > STREAK_TIMEOUT_S) streak = 0; // stale streak fizzles, silent
    streak += 1;
    lastKillT = t;
    var id = MILESTONES[streak];
    if (id) ksVoice(id);
  }

  function breakStreak() {
    if (streak >= 2) voice(BROKEN_ID); // broken mid-streak, ungated: fires once per streak
    streak = 0;
  }

  if (window.SF && SF.Enemies) {
    // killstreak counting: same kill events the combat feed reads.
    var _kill = SF.Enemies.kill;
    SF.Enemies.kill = function (e) {
      var r = _kill.apply(this, arguments);
      try { onPlayerKill(); } catch (err) {}
      return r;
    };

    // kamikaze telegraph start: pattern phase flips to 'telegraph' on the
    // first update tick after spawn (see enemies.js updatePatternEnemy).
    var _update = SF.Enemies.update;
    SF.Enemies.update = function (dt) {
      var r = _update.apply(this, arguments);
      try {
        var list = SF.Enemies.list;
        for (var i = 0; i < list.length; i++) {
          var ke = list[i];
          if (!ke._ksvKami && ke.pattern === 'kamikaze' &&
              ke.pat && ke.pat.phase === 'telegraph') {
            ke._ksvKami = true; // one announcement per kamikaze
            voice('ambushelite_02');
          }
        }
      } catch (err) {}
      return r;
    };

    // bounty-hunter ambush + swarmlord elite spawn detection.
    var _spawn = SF.Enemies.spawn;
    SF.Enemies.spawn = function (typeId, x, y, mul, opts) {
      var e = _spawn.apply(this, arguments);
      try {
        if (e) {
          if (opts && opts.encounter === 'hunter') voice('ambushelite_01');
          else if (e.elite === 'swarmlord') voice('ambushelite_03');
        }
      } catch (err) {}
      return e;
    };
  }

  if (window.SF && SF.Encounters && SF.Encounters.run) {
    // pirate ambush encounter = the wolfpack converging.
    var _run = SF.Encounters.run;
    SF.Encounters.run = function (kind) {
      var r = _run.apply(this, arguments);
      try { if (kind === 'ambush') voice('ambushelite_04'); } catch (e) {}
      return r;
    };
  }

  if (window.SF && SF.Player && SF.Player.takeDamage) {
    // hull damage (not shield absorbs) breaks an active streak.
    var _td = SF.Player.takeDamage;
    SF.Player.takeDamage = function (dmg) {
      var before = NaN;
      try { before = SF.Player.hull; } catch (e) {}
      var r = _td.apply(this, arguments);
      try {
        var after = SF.Player.hull;
        if (!isNaN(before) && after < before) breakStreak();
      } catch (e) {}
      return r;
    };
  }

  if (window.SF && SF.Game && SF.Game.newGame) {
    // fresh pilot, no streak; silent.
    var _ng = SF.Game.newGame;
    SF.Game.newGame = function () {
      streak = 0; lastKillT = 0;
      return _ng.apply(this, arguments);
    };
  }

  SF.KillstreakVoice = {
    _installed: true,
    testState: function () {
      return { streak: streak, lastKillT: lastKillT, lastKsVoiceT: lastKsVoiceT, now: nowS() };
    },
    // smoke-test hook: reset streak + per-line cooldown gates. Never called by the game.
    testReset: function () { streak = 0; lastKillT = 0; lastKsVoiceT = {}; }
  };
})();
/* ============================================================
 * STARFALL — mining-survey phase (2026-10-20)
 *
 * SF.Survey: ship-mounted survey scanner + asteroid node tiers.
 *
 *   PING — press X (or tap the 📡 PING touch button, coarse pointers
 *          only) to emit a survey pulse. 2s cooldown. Every asteroid
 *          within PING_RANGE (1100 world units) of the player shows a
 *          richness pip above it for 8s:
 *            grey  — Common  (richness < 0.6)
 *            cyan  — Rich    (richness >= 0.6, same metric as the mining
 *                              minigame's sweet-spot bar + outposts)
 *            gold  — MOTHERLODE (designated, one per belt)
 *   MOTHERLODE — on each ping, if no live motherlode exists, the richest
 *          rock with richness >= 0.85 in range is designated the belt's
 *          motherlode (gold pip + pulsing gold ring). Rocks die once in
 *          this engine, so "depletes after 3 mining runs" is implemented
 *          as vein charges: a lethal hit on the motherlode cracks a vein
 *          instead of killing it — the rock revives at full hp, sheds
 *          2.5x ore, and consumes a charge. After 3 charges it downgrades
 *          to Rich (gold pip gone) and the next lethal hit kills it
 *          normally. The 2.5x applies to everything the break yields
 *          (base ore + any mining-bar sweet-spot bonus), so a perfect
 *          sweet-spot on a motherlode is a jackpot — deterministic, no
 *          double-counting.
 *
 * Integration is runtime-only from this file, in the style of the
 * mining-outposts phase: SF.Encounters.tick is chained (never edited),
 * SF.Asteroids.draw and SF.Asteroids.damage are wrapped (never edited),
 * and the X-key listener + 📡 touch button are additive DOM. The damage
 * wrap is installed on the second tick on purpose: the main loop calls
 * SF.Encounters.tick before SF.MiningBar.update, so deferring one frame
 * guarantees our wrap sits ON TOP of the mining bar's (its extras then
 * flow through our spawn counter exactly once).
 *
 * Save-neutral: pips, pings, cooldowns, vein charges and the _surveyML
 * rock flag are all runtime-only. No SF.SAVE_VERSION bump, no save-blob
 * changes — a save from before this phase loads fine, and this phase's
 * state simply isn't persisted.
 *
 * Nothing in this file touches the live tree; the safe-room audit copies
 * the changed file into a combined tree and runs smoke.mjs --base <dir>.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.Survey && SF.Survey._installed) return; // no double install

  /* ---------------- tuning ---------------- */
  var COOLDOWN = 2;          // seconds between pings
  var REVEAL_DUR = 8;        // seconds richness pips stay visible
  var PING_RANGE = 1100;     // world units from the player: rocks inside are revealed
  var RICH_MIN = 0.6;        // cyan tier (same metric as mining minigame + outposts)
  var MOTHERLODE_MIN = 0.85; // gold tier gate
  var ML_MULT = 2.5;         // motherlode ore multiplier
  var ML_RUNS = 3;           // vein charges before downgrade to Rich
  var TIER_COLOR = { common: '#9aa3b2', rich: '#4de3ff', motherlode: '#ffd23f' };

  function toast(msg) { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function sfx(id) { try { if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx(id); } catch (e) {} }

  /* same richness metric as the mining minigame (bigger rocks = richer) */
  function richness(a) {
    var cfg = SF.CONFIG.asteroid;
    return Math.max(0, Math.min(1,
      (a.r - cfg.radiusMin) / Math.max(1, cfg.radiusMax - cfg.radiusMin)));
  }

  function dist2(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  /* ---------------- runtime state (never persisted) ---------------- */
  var cooldown = 0;
  var revealT = 0;
  var pingSystem = null;
  var revealed = [];   // [{a, tier}] — rock refs; cleared on system change
  var pings = [];      // expanding ring VFX [{x, y, t, dur}]
  var surveyWanted = false; // set by X key / touch button, consumed by the tick
  var tickN = 0;
  var hooksInstalled = false;
  var dmgInstalled = false;
  var sCounting = false, sCountN = 0;
  var lastBreak = null; // test hook: {base, extra} of the last motherlode vein break
  var wrapEl = null, btnEl = null;
  var coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) {}

  function liveMotherlode() {
    var list = (SF.Asteroids && SF.Asteroids.list) || [];
    for (var i = 0; i < list.length; i++)
      if (!list[i].dead && list[i]._surveyML) return list[i];
    return null;
  }

  /* ---------------- the ping ---------------- */

  function tryPing() {
    if (!SF.Game || SF.Game.state !== 'PLAYING') return false;
    if (cooldown > 0) { toast('\uD83D\uDCE1 Survey recharging\u2026'); return false; }
    var p = SF.Player;
    if (!p) return false;
    var list = (SF.Asteroids && SF.Asteroids.list) || [];
    var inRange = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || a.dead) continue;
      if (dist2(p.x, p.y, a.x, a.y) > PING_RANGE * PING_RANGE) continue;
      inRange.push(a);
    }
    if (!inRange.length) {
      toast('📡 Survey ping: no asteroids in range.');
      return false; // no cooldown burned on an empty ping
    }
    cooldown = COOLDOWN;
    revealT = REVEAL_DUR;
    pingSystem = SF.Game.systemId;
    revealed = [];
    pings.push({ x: p.x, y: p.y, t: 0, dur: 0.8 });
    if (window.SF && SF.Particles) SF.Particles.burst(p.x, p.y, '#4de3ff', 14, 200, 0.5, 3);
    sfx('survey_ping');

    // designate the belt's motherlode (one per belt): richest rock >= 0.85
    var ml = liveMotherlode();
    if (!ml) {
      var best = null, bestR = -1;
      for (var j = 0; j < inRange.length; j++) {
        var r = richness(inRange[j]);
        if (r >= MOTHERLODE_MIN && r > bestR) { bestR = r; best = inRange[j]; }
      }
      if (best) {
        best._surveyML = true;
        best._surveyMLRuns = 0;
        ml = best;
        sfx('survey_find');
      }
    }
    var nRich = 0;
    for (var k = 0; k < inRange.length; k++) {
      var rk = inRange[k], rr = richness(rk);
      var tier = (ml && rk === ml) ? 'motherlode' : (rr >= RICH_MIN ? 'rich' : 'common');
      if (tier !== 'common') nRich++;
      revealed.push({ a: rk, tier: tier, rich: rr });
    }
    if (ml) {
      toast('📡 Survey: ' + nRich + ' rich node' + (nRich === 1 ? '' : 's') +
        ' — ⬢ MOTHERLODE located (2.5x ore, 3 veins)!');
      sfx('mineral_vein_found');
    } else {
      toast('📡 Survey: ' + nRich + ' rich node' + (nRich === 1 ? '' : 's') +
        ' revealed (' + inRange.length + ' rocks scanned).');
    }
    return true;
  }

  /* ---------------- motherlode vein charges (damage wrap) ---------------- */

  function installDamageWrap() {
    if (dmgInstalled) return;
    dmgInstalled = true; // set first: never double-install, even if SF is half-ready
    var A = SF.Asteroids;
    if (!A || !A.damage || A.damage._surveyWrapped) return;
    if (!SF.Pickups || !SF.Pickups.spawnOre || SF.Pickups.spawnOre._surveyWrapped) return;
    var origDamage = A.damage;
    var origSpawn = SF.Pickups.spawnOre;
    var sw = function (x, y, amount) {
      if (sCounting) sCountN += (amount || 1);
      return origSpawn.call(SF.Pickups, x, y, amount);
    };
    sw._surveyWrapped = true;
    SF.Pickups.spawnOre = sw;
    var wd = function (a, dmg, isBeam) {
      var wasDead = !!(a && a.dead);
      var wasML = !!(a && a._surveyML);
      sCounting = true; sCountN = 0;
      var r = origDamage.call(A, a, dmg, isBeam);
      sCounting = false;
      // a vein charge is consumed only when THIS hit killed the motherlode
      if (wasML && !wasDead && a.dead) {
        var runs = a._surveyMLRuns || 0;
        if (runs < ML_RUNS) {
          // the vein cracks open instead of the rock dying
          a.dead = false;
          a.hp = a.maxHp;
          a._surveyMLRuns = runs + 1;
          var extra = Math.round(sCountN * (ML_MULT - 1));
          lastBreak = { base: sCountN, extra: extra };
          for (var i = 0; i < extra; i++)
            origSpawn.call(SF.Pickups,
              a.x + (Math.random() - 0.5) * a.r * 0.8,
              a.y + (Math.random() - 0.5) * a.r * 0.8, 1);
          if (window.SF && SF.Particles) {
            SF.Particles.burst(a.x, a.y, '#ffd23f', 26, 260, 0.7, 4);
            SF.Particles.sparks(a.x, a.y, '#ffd23f');
          }
          if (window.SF && SF.FX && SF.FX.shake) SF.FX.shake(4);
          sfx('mineral_vein_found');
          if (a._surveyMLRuns >= ML_RUNS) {
            a._surveyML = false; // downgraded to Rich
            toast('⛏ Motherlode depleted — downgraded to a Rich node.');
            sfx('node_deplete');
          } else {
            toast('⛏ MOTHERLODE 2.5x ore — vein ' + a._surveyMLRuns + '/' + ML_RUNS);
          }
        } else {
          a._surveyML = false; // spent: dies as a normal rock
        }
      }
      return r;
    };
    wd._surveyWrapped = true;
    A.damage = wd;
  }

  /* ---------------- world-space rendering (additive wrap) ---------------- */

  function drawSurvey(ctx) {
    // expanding ping rings
    for (var i = pings.length - 1; i >= 0; i--) {
      var pg = pings[i];
      var k = pg.t / pg.dur;
      if (k >= 1) { pings.splice(i, 1); continue; }
      ctx.save();
      ctx.strokeStyle = 'rgba(77,227,255,' + (0.7 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pg.x, pg.y, 40 + k * PING_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,210,63,' + (0.4 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pg.x, pg.y, 40 + k * PING_RANGE * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (revealT <= 0 || !revealed.length) return;
    var now = performance.now() / 1000;
    for (var j = 0; j < revealed.length; j++) {
      var e = revealed[j], a = e.a;
      if (!a || a.dead) continue;
      var col = TIER_COLOR[e.tier] || TIER_COLOR.common;
      var s = (e.tier === 'motherlode') ? 7 : 5;
      ctx.save();
      ctx.translate(a.x, a.y - a.r - 14);
      ctx.rotate(Math.PI / 4);
      if (e.tier === 'motherlode') { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.fillStyle = col;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      if (e.tier === 'motherlode') {
        var pr = a.r + 8 + 3 * Math.sin(now * 5);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,210,63,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(a.x, a.y, pr, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ---------------- DOM: X key + touch button (additive) ---------------- */

  function ensureDom() {
    if (wrapEl) return;
    var d = document.createElement('div');
    d.id = 'survey-wrap';
    d.className = 'hidden';
    d.style.cssText = 'position:fixed;right:134px;' +
      'bottom:calc(30px + env(safe-area-inset-bottom));z-index:26;';
    var b = document.createElement('button');
    b.id = 'btn-survey';
    b.className = 'btn ui-block';
    b.style.cssText = 'width:76px;height:76px;border-radius:50%;font-size:13px;' +
      'font-weight:bold;background:rgba(40,120,160,0.35);' +
      'border:2px solid rgba(77,227,255,0.85);color:#cfefff;';
    b.textContent = '📡 PING';
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      surveyWanted = true;
    });
    d.appendChild(b);
    document.body.appendChild(d);
    wrapEl = d; btnEl = b;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'KeyX' && !e.repeat) surveyWanted = true;
    });
  }

  /* ---------------- per-tick update (PLAYING only) ---------------- */

  function tick(dt) {
    ensureDom();
    tickN++;
    // main loop runs SF.Encounters.tick before SF.MiningBar.update, so by the
    // second tick the mining bar's damage wrap exists and ours goes on top.
    if (tickN === 2) installDamageWrap();
    if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
    if (revealT > 0) {
      revealT -= dt;
      if (revealT <= 0) { revealT = 0; revealed = []; }
      else if (SF.Game && pingSystem && SF.Game.systemId !== pingSystem) {
        revealT = 0; revealed = []; // stale field: rocks regenerated
      }
    }
    for (var i = 0; i < pings.length; i++) pings[i].t += dt;
    if (surveyWanted) {
      surveyWanted = false;
      tryPing();
    }
    var show = coarse && SF.Game && SF.Game.state === 'PLAYING';
    if (wrapEl) {
      wrapEl.classList.toggle('hidden', !show);
      if (show && btnEl) {
        btnEl.textContent = cooldown > 0 ? '📡 ' + cooldown.toFixed(1) + 's' : '📡 PING';
        btnEl.style.opacity = cooldown > 0 ? '0.45' : '1';
      }
    }
  }

  /* ---------------- runtime wiring ---------------- */

  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    if (SF.Asteroids && SF.Asteroids.draw && !SF.Asteroids.draw._survey) {
      var _draw = SF.Asteroids.draw;
      var wrapped = function (ctx) { _draw.call(SF.Asteroids, ctx); drawSurvey(ctx); };
      wrapped._survey = true;
      SF.Asteroids.draw = wrapped;
    }
  }

  var S = {
    _installed: true,
    COOLDOWN: COOLDOWN, REVEAL_DUR: REVEAL_DUR, PING_RANGE: PING_RANGE,
    RICH_MIN: RICH_MIN, MOTHERLODE_MIN: MOTHERLODE_MIN,
    ML_MULT: ML_MULT, ML_RUNS: ML_RUNS,

    /* external trigger (HUD button uses the internal flag; tests use this) */
    ping: function () { surveyWanted = true; return true; },
    /* test-only: {base, extra} ore counts of the last motherlode vein break */
    testLastBreak: function () { return lastBreak; },
    richness: richness,

    testState: function () {
      var ml = liveMotherlode();
      var tiers = [];
      for (var i = 0; i < revealed.length; i++) tiers.push(revealed[i].tier);
      return {
        cooldown: Math.round(cooldown * 100) / 100,
        revealT: Math.round(revealT * 100) / 100,
        revealed: revealed.length,
        tiers: tiers,
        motherlode: !!ml,
        mlRuns: ml ? (ml._surveyMLRuns || 0) : 0,
        damageWrapped: !!(SF.Asteroids && SF.Asteroids.damage && SF.Asteroids.damage._surveyWrapped)
      };
    },

    /* test-only: force-designate the richest rock as motherlode (bypasses
       the 0.85 gate so the smoke doesn't depend on field RNG). Never called
       by the game. */
    testForceMotherlode: function () {
      var list = (SF.Asteroids && SF.Asteroids.list) || [];
      var best = null, bestR = -1;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a || a.dead) continue;
        var r = richness(a);
        if (r > bestR) { bestR = r; best = a; }
      }
      if (!best) return null;
      best._surveyML = true;
      best._surveyMLRuns = 0;
      return { richness: Math.round(bestR * 1000) / 1000 };
    },

    /* test-only: clear all runtime survey state. Never called by the game. */
    testReset: function () {
      cooldown = 0; revealT = 0; revealed = []; pings = [];
      var list = (SF.Asteroids && SF.Asteroids.list) || [];
      for (var i = 0; i < list.length; i++) {
        list[i]._surveyML = false; list[i]._surveyMLRuns = 0;
      }
    }
  };
  SF.Survey = S;

  // chain onto the encounter tick (PLAYING-only update path, like outposts)
  if (window.SF && SF.Encounters && !SF.Encounters._surveyHooked) {
    SF.Encounters._surveyHooked = true;
    var _tick = SF.Encounters.tick;
    SF.Encounters.tick = function (dt) {
      _tick.call(SF.Encounters, dt);
      installHooks();
      tick(dt);
    };
  }
})();
/* ============================================================
 * STARFALL — killstreak-sfx-wiring phase (2026-10-21)
 *
 * SF.KillstreakSfx: wires sfx-bank-v6's killstreak stingers into
 * gameplay. Wraps-only integration (never edits any other module or
 * this file's existing phases), mirroring SF.KillstreakVoice.
 *
 * Triggers — every call guarded:
 *     if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('<id>')
 *   killstreak_10 — player kill streak hits 10 kills.
 *   killstreak_25 — hits 25 kills.
 *   killstreak_50 — hits 50 kills.
 *   questFail     — an active streak (>= 2) is broken by hull damage
 *     (shield-only absorbs don't count). questFail.ogg is an existing
 *     banked id (sfx bank, live in assets/audio/sfx/) — zero invented
 *     ids. Semantics match killstreak-voice-wiring: a streak that
 *     fizzles from the 30s no-kill timeout, or is reset by newGame,
 *     stays silent.
 *
 * Router behavior (sfx-hooks-v6): SF.Audio.sfx('<id>') probes the OGG
 * buffer cache first and falls back to the synth (questTurnIn for the
 * three stingers, questFail's own synth) when the file is missing, so
 * the game never breaks on absent assets.
 *
 * Save-neutral: all state is runtime-only; no SF.SAVE_VERSION bump.
 * New SF.* surface: SF.KillstreakSfx only (_installed + testState /
 * testReset debug hooks for smoke tests). No signature changes.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.KillstreakSfx && SF.KillstreakSfx._installed) return; // no double install

  /* ---- tuning ---- */
  var MILESTONES = { // streak count -> sfx id (exact ids, sfx-bank-v6)
    10: 'killstreak_10', 25: 'killstreak_25', 50: 'killstreak_50'
  };
  var STREAK_LOST_ID = 'questFail'; // existing banked id; no invention
  var STREAK_TIMEOUT_S = 30; // no kill for this long: streak fizzles, silent

  /* ---- runtime state (never saved) ---- */
  var streak = 0;        // consecutive player-caused kills
  var lastKillT = 0;     // s, for the fizzle timeout

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  /* Guarded sfx call — the router handles OGG-first + synth fallback. */
  function sfx(id) {
    try {
      if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx(id);
    } catch (e) { /* audio is best-effort; never break gameplay */ }
  }

  function onPlayerKill() {
    var t = nowS();
    if (t - lastKillT > STREAK_TIMEOUT_S) streak = 0; // stale streak fizzles, silent
    streak += 1;
    lastKillT = t;
    var id = MILESTONES[streak];
    if (id) sfx(id);
  }

  function breakStreak() {
    if (streak >= 2) sfx(STREAK_LOST_ID); // broken mid-streak, ungated: fires once per streak
    streak = 0;
  }

  if (window.SF && SF.Enemies) {
    // killstreak counting: same kill events the combat feed reads.
    var _kill = SF.Enemies.kill;
    SF.Enemies.kill = function (e) {
      var r = _kill.apply(this, arguments);
      try { onPlayerKill(); } catch (err) {}
      return r;
    };
  }

  if (window.SF && SF.Player && SF.Player.takeDamage) {
    // hull damage (not shield absorbs) breaks an active streak.
    var _td = SF.Player.takeDamage;
    SF.Player.takeDamage = function (dmg) {
      var before = NaN;
      try { before = SF.Player.hull; } catch (e) {}
      var r = _td.apply(this, arguments);
      try {
        var after = SF.Player.hull;
        if (!isNaN(before) && after < before) breakStreak();
      } catch (e) {}
      return r;
    };
  }

  if (window.SF && SF.Game && SF.Game.newGame) {
    // fresh pilot, no streak; silent.
    var _ng = SF.Game.newGame;
    SF.Game.newGame = function () {
      streak = 0; lastKillT = 0;
      return _ng.apply(this, arguments);
    };
  }

  SF.KillstreakSfx = {
    _installed: true,
    testState: function () {
      return { streak: streak, lastKillT: lastKillT, now: nowS() };
    },
    // smoke-test hook: reset streak. Never called by the game.
    testReset: function () { streak = 0; lastKillT = 0; }
  };
})();

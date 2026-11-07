/* STARFALL Phase 2 — parts.js
 * Ship parts: star multipliers, effective stats, build derivation (power budget,
 * derived ship stats), grid fit checks, starter fits for new hulls.
 * A "fitted part" is { partId, gx, gy, rotated, stars }.
 */
window.SF = window.SF || {};

SF.Parts = (function () {
  function starMult(stars) {
    return 1 + SF.CONFIG.upgrades.starStep * (Math.max(1, Math.min(5, stars)) - 1);
  }

  function dims(fp) {
    var p = SF.PART_BY_ID[fp.partId];
    if (!p) return { w: 0, h: 0 };
    return fp.rotated ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  }

  /* Effective stats of one fitted part, with its star multiplier applied. */
  function effStats(fp) {
    var p = SF.PART_BY_ID[fp.partId];
    if (!p) return {};
    var m = starMult(fp.stars || 1);
    var out = {};
    Object.keys(p.stats).forEach(function (k) { out[k] = p.stats[k] * m; });
    return out;
  }

  function inBounds(classDef, fp) {
    var d = dims(fp);
    return fp.gx >= 0 && fp.gy >= 0 &&
      fp.gx + d.w <= classDef.gridW && fp.gy + d.h <= classDef.gridH;
  }

  function rectsOverlap(a, b) {
    return a.gx < b.gx + b.w && a.gx + a.w > b.gx &&
           a.gy < b.gy + b.h && a.gy + a.h > b.gy;
  }

  /* Can fp be placed on classDef's grid given the other fitted parts? */
  function canPlace(classDef, fitted, fp, ignoreIndex) {
    if (!inBounds(classDef, fp)) return false;
    var d = dims(fp);
    var r = { gx: fp.gx, gy: fp.gy, w: d.w, h: d.h };
    for (var i = 0; i < fitted.length; i++) {
      if (i === ignoreIndex) continue;
      var od = dims(fitted[i]);
      if (rectsOverlap(r, { gx: fitted[i].gx, gy: fitted[i].gy, w: od.w, h: od.h })) return false;
    }
    return true;
  }

  /* Derive full ship stats from class + fitted parts. */
  function derive(classId, fitted) {
    var cls = SF.SHIP_CLASS_BY_ID[classId];
    var s = {
      hull: cls.hull, shield: cls.shield, speed: cls.speed,
      powerGen: 0, powerUse: 0, powerNet: 0,
      cargo: cls.cargoBonus, crewCap: 0, slots: 0,
      engines: 0, reactors: 0,
      valid: true, reasons: [],
      /* shipwright-expansion-1: aggregates for the five new part families.
       * derive() is the single funnel every consumer reads (builder stats,
       * ship.js buildStats, station quotes), and the SF.PartSystems runtime
       * at the bottom of this file keys off these exact fields:
       *   drones      drone-bay capacity (star-scaled, runtime floors at 4)
       *   droneDmg    per-drone bolt damage (drone-weighted average across bays)
       *   pd          point-defense mounts (star-scaled; runtime floors at 4)
       *   pdRange     widest PD intercept radius among fitted PD mounts
       *   ecm         enemy-fire deviation in radians at spawn (sum)
       *   sensor      survey ping range extension fraction (sum)
       *   mining      bonus ore fraction on rock breaks (sum)
       *   miningDmg   asteroid damage multiplier fraction (sum)
       *   cloak       1 when any cloaking array is fitted (max)
       *   cloakRadius widest cloak no-fire radius (max) */
      drones: 0, droneDmg: 0, pd: 0, pdRange: 0,
      ecm: 0, sensor: 0, mining: 0, miningDmg: 0,
      cloak: 0, cloakRadius: 0
    };
    var droneDmgW = 0; // shipwright-expansion-1: per-drone damage accumulator
    fitted = fitted || [];
    for (var i = 0; i < fitted.length; i++) {
      var fp = fitted[i], p = SF.PART_BY_ID[fp.partId];
      if (!p) continue;
      var m = starMult(fp.stars || 1);
      if (p.power > 0) s.powerGen += p.power * m;
      else s.powerUse += -p.power;
      var es = effStats(fp);
      if (es.speed) s.speed += es.speed;
      if (es.hull) s.hull += es.hull;
      if (es.shield) s.shield += es.shield;
      if (es.cargo) s.cargo += es.cargo;
      if (es.crew) s.crewCap += es.crew;
      if (es.slots) s.slots += es.slots;
      // shipwright-expansion-1: new-family aggregation
      if (es.drones) { s.drones += es.drones; droneDmgW += (es.droneDmg || 0) * es.drones; }
      if (es.pd) s.pd += es.pd;
      if (es.pdRange) s.pdRange = Math.max(s.pdRange, es.pdRange);
      if (es.ecm) s.ecm += es.ecm;
      if (es.sensor) s.sensor += es.sensor;
      if (es.mining) s.mining += es.mining;
      if (es.miningDmg) s.miningDmg += es.miningDmg;
      if (es.cloak) s.cloak = Math.max(s.cloak, es.cloak);
      if (es.cloakRadius) s.cloakRadius = Math.max(s.cloakRadius, es.cloakRadius);
      if (p.type === 'engine') s.engines++;
      if (p.type === 'reactor') s.reactors++;
    }
    s.powerNet = s.powerGen - s.powerUse;
    s.hull = Math.round(s.hull); s.shield = Math.round(s.shield);
    s.speed = Math.round(s.speed); s.cargo = Math.round(s.cargo);
    s.crewCap = Math.round(s.crewCap); s.slots = Math.round(s.slots);
    // shipwright-expansion-1: finalize the pooled per-drone damage
    if (s.drones > 0) s.droneDmg = Math.round((droneDmgW / s.drones) * 10) / 10;
    s.ecm = Math.round(s.ecm * 1000) / 1000;
    s.sensor = Math.round(s.sensor * 1000) / 1000;
    s.mining = Math.round(s.mining * 1000) / 1000;
    s.miningDmg = Math.round(s.miningDmg * 1000) / 1000;
    /* cloak is a boolean fit flag (stars grow the radius, not the flag),
     * and ranges read as whole units everywhere they are displayed */
    if (s.cloak > 0) s.cloak = 1;
    s.cloakRadius = Math.round(s.cloakRadius);
    s.pdRange = Math.round(s.pdRange);
    if (s.engines < 1) { s.valid = false; s.reasons.push('No engine fitted'); }
    if (s.reactors < 1) { s.valid = false; s.reasons.push('No reactor fitted'); }
    if (s.powerNet < 0) { s.valid = false; s.reasons.push('Power deficit: ' + s.powerNet); }
    return s;
  }

  /* Simple shelf packer for starter fits: places parts left-to-right, top-to-bottom. */
  function packFit(classId, partIds) {
    var cls = SF.SHIP_CLASS_BY_ID[classId];
    var fitted = [];
    var cx = 0, cy = 0, rowH = 0;
    for (var i = 0; i < partIds.length; i++) {
      var p = SF.PART_BY_ID[partIds[i]];
      if (!p) continue;
      // try rotated if it helps the current row
      var w = p.w, h = p.h, rotated = false;
      if (cx + w > cls.gridW && p.h <= cls.gridW - cx && p.w <= cls.gridH - cy) {
        w = p.h; h = p.w; rotated = true;
      }
      if (cx + w > cls.gridW) { cx = 0; cy += rowH; rowH = 0; }
      if (cy + h > cls.gridH) continue; // doesn't fit — skip
      var fp = { partId: p.id, gx: cx, gy: cy, rotated: rotated, stars: 1 };
      if (canPlace(cls, fitted, fp, -1)) {
        fitted.push(fp);
        cx += w;
        if (h > rowH) rowH = h;
      }
    }
    return fitted;
  }

  /* Default fit for a fresh hull: reactor + engine + mount, armor for big hulls. */
  function starterFit(classId) {
    var cls = SF.SHIP_CLASS_BY_ID[classId];
    var cells = cls.gridW * cls.gridH;
    var reactor = 'fission_cell', engine = 'ion_thruster', mount = 'light_hardpoint';
    if (cells >= 24) { reactor = 'fusion_core'; engine = 'fusion_drive'; }
    if (cells >= 40) { mount = 'heavy_hardpoint'; }
    var ids = [reactor, engine, mount];
    /* twelve-hour-wave1: the starter Fighter shipped with exactly ONE mount,
     * occupied by the Pulse Laser — so the tutorial's BUY A WEAPON step was
     * uncompletable even with 180c (every store BUY button stays disabled
     * with no free hardpoint, and there is no sell-weapon path). A second
     * light mount gives a fresh pilot a free slot to buy into. Power stays
     * positive (fission 20 - ion 8 - mount 4 - mount 4 = 4) and only the
     * ACTIVE weapon fires (swap via the HUD button), so this adds an
     * option, not double DPS. Fighter-only: other classes keep their fits. */
    if (classId === 'fighter') ids.push('light_hardpoint');
    if (cells >= 35) ids.push('hull_plating');
    if (cells >= 70) ids.push('deflector_dish', 'cargo_hold');
    if (cells >= 110) ids.push('hab_deck', 'composite_armor');
    return packFit(classId, ids);
  }

  return {
    starMult: starMult,
    dims: dims,
    effStats: effStats,
    canPlace: canPlace,
    derive: derive,
    starterFit: starterFit,
    classById: function (id) { return SF.SHIP_CLASS_BY_ID[id]; }
  };
})();

/* ================================================================
 * shipwright-expansion-1 — five new part families + SF.PartSystems
 * ----------------------------------------------------------------
 * BRIEF hard rule: every new family needs an HONEST live effect wired
 * into flight/combat. This section does it from inside parts.js only,
 * using the codebase's established integration styles:
 *
 *  - Registration: post-hoc SF.PARTS.push, the same pattern data.js
 *    uses for late part lines (aegis_plating). New parts flow into the
 *    station store, star upgrades, loot filters and saves with no
 *    other file touched. Power draw uses the stock rule (flat, part of
 *    the reactor budget check in derive()).
 *  - Effects run in SF.PartSystems, a runtime keyed off the aggregated
 *    stats SF.Parts.derive() now reports for the ACTIVE ship:
 *      drone bay    friendly combat drones, maintained/ticked/drawn by
 *                   wrapped SF.Player.update / SF.Player.draw
 *      point-def.   zaps hostile projectiles + shoots carrier drones,
 *                   pattern ported from the wingman Guard PD (ship.js)
 *      sensor/ECM   wraps SF.Projectiles.spawn (deviates hostile fire,
 *                   weakens homing) + extends SF.Survey pings (extra
 *                   reveal pips drawn on SF.Asteroids.draw)
 *      mining rig   wraps SF.Asteroids.damage (harder hits on rock,
 *                   bonus ore counted like SF.Survey's motherlode wrap)
 *      cloak        wrapped Player.update holds enemy fire + clears
 *                   aggro inside the radius; firing (SF.Audio.weaponSound
 *                   wrap) or taking a hit (SF.Player.takeDamage wrap)
 *                   drops it, with a 1.1s enemy reacquire delay
 *  All wraps are flag-guarded, idempotent, try/catch-wrapped, and
 *  chain-safe with the other deferred wraps in the tree (Survey,
 *  combat-context HUD, ship transponder). Save format is untouched:
 *  fitted parts persist as {partId,gx,gy,rotated,stars} — v12 stays.
 * ================================================================ */
(function registerShipwrightParts() {
  'use strict';
  if (!window.SF || !SF.PARTS || !SF.PART_BY_ID) return;
  var defs = [
    /* ---- Drone Bay (type 'dronebay') — friendly combat drones ---- */
    { id: 'drone_bay_mk1', name: 'Scout Drone Bay', type: 'dronebay', tier: 'white', maker: 'kestrel',
      w: 2, h: 1, power: -10, stats: { drones: 1, droneDmg: 6 }, price: 700,
      desc: 'Launches a small combat drone that orbits your ship and engages hostiles. Drone damage 6.' },
    { id: 'drone_bay_mk2', name: 'Striker Drone Bay', type: 'dronebay', tier: 'blue', maker: 'kestrel',
      w: 2, h: 2, power: -16, stats: { drones: 2, droneDmg: 9 }, price: 2400,
      desc: 'Twin launch rails for a pair of striker drones. Drone damage 9 each.' },
    { id: 'drone_bay_mk3', name: 'Hive Drone Bay', type: 'dronebay', tier: 'purple', maker: 'kestrel',
      w: 3, h: 2, power: -24, stats: { drones: 3, droneDmg: 12 }, price: 6800,
      desc: 'A compact hive that keeps three combat drones in the air. Drone damage 12 each.' },
    { id: 'drone_bay_mk4', name: 'Swarm Sovereign Bay', type: 'dronebay', tier: 'gold', maker: 'kestrel',
      w: 3, h: 2, power: -34, stats: { drones: 4, droneDmg: 16 }, price: 19000,
      desc: 'The full swarm: four heavy drones with real teeth. Drone damage 16 each. Rare — shipwright stock only.' },

    /* ---- Point-Defense Mount (type 'pd') — missile/drone interception ---- */
    { id: 'pd_flaklet', name: 'Flaklet PD Turret', type: 'pd', tier: 'white', maker: 'aegis',
      w: 1, h: 1, power: -6, stats: { pd: 1, pdRange: 130 }, price: 450,
      desc: 'A stubby point-defense turret. Zaps incoming missiles and bolts before they reach your hull (130u).' },
    { id: 'pd_sentry', name: 'Sentry PD Array', type: 'pd', tier: 'blue', maker: 'aegis',
      w: 2, h: 1, power: -10, stats: { pd: 1, pdRange: 165 }, price: 1800,
      desc: 'A faster point-defense array with a wider intercept bubble (165u).' },
    { id: 'pd_bulwark', name: 'Bulwark PD Battery', type: 'pd', tier: 'purple', maker: 'aegis',
      w: 2, h: 2, power: -16, stats: { pd: 2, pdRange: 185 }, price: 5200,
      desc: 'Twin point-defense mounts cross-covering a 185u bubble. Also engages enemy drones.' },
    { id: 'pd_aegis_net', name: 'Aegis Net PD', type: 'pd', tier: 'gold', maker: 'aegis',
      w: 2, h: 2, power: -22, stats: { pd: 2, pdRange: 220 }, price: 14000,
      desc: 'A woven interception net: two rapid mounts over a 220u bubble. Missiles rarely get through.' },

    /* ---- Sensor/ECM Suite (type 'sensor') — ping reach + fire jamming ---- */
    { id: 'sensor_array_mk1', name: 'Surveyor Sensor Array', type: 'sensor', tier: 'white', maker: 'vantia',
      w: 2, h: 1, power: -5, stats: { sensor: 0.25, ecm: 0.04 }, price: 550,
      desc: 'Survey pings reveal rich rocks 25% farther out. Light ECM blurs enemy aim by 4%.' },
    { id: 'sensor_array_mk2', name: 'Deep-Scan Sensor Suite', type: 'sensor', tier: 'blue', maker: 'vantia',
      w: 2, h: 2, power: -9, stats: { sensor: 0.5, ecm: 0.08 }, price: 2100,
      desc: 'Survey pings reach 50% farther. ECM blurs enemy aim by 8% and bends homing shots.' },
    { id: 'sensor_ghostline', name: 'Ghostline ECM Suite', type: 'sensor', tier: 'purple', maker: 'vantia',
      w: 2, h: 2, power: -14, stats: { sensor: 0.75, ecm: 0.14 }, price: 5900,
      desc: 'Military-grade ghostline: pings reach 75% farther, enemy aim blurred 14%, homing badly degraded.' },
    { id: 'sensor_oracle', name: 'Oracle Sensor Crown', type: 'sensor', tier: 'gold', maker: 'vantia',
      w: 3, h: 2, power: -20, stats: { sensor: 1.0, ecm: 0.2 }, price: 16000,
      desc: 'Doubles survey ping reach and scrambles a fifth of every hostile firing solution.' },

    /* ---- Mining Rig (type 'mining') — yield + rock-breaking ---- */
    { id: 'mining_rig_mk1', name: 'Prospector Mining Rig', type: 'mining', tier: 'white', maker: 'helion',
      w: 2, h: 1, power: -6, stats: { mining: 0.25, miningDmg: 0.25 }, price: 600,
      desc: 'Reinforced cutting head and a sorting scoop: +25% ore from every rock, hits rock 25% harder.' },
    { id: 'mining_rig_mk2', name: 'Extractor Mining Rig', type: 'mining', tier: 'blue', maker: 'helion',
      w: 2, h: 2, power: -10, stats: { mining: 0.5, miningDmg: 0.4 }, price: 2200,
      desc: '+50% ore yield and 40% harder rock hits. The belt pays for itself fast.' },
    { id: 'mining_rig_mk3', name: 'Motherlode Mining Rig', type: 'mining', tier: 'purple', maker: 'helion',
      w: 3, h: 2, power: -15, stats: { mining: 0.85, miningDmg: 0.6 }, price: 6400,
      desc: '+85% ore yield, 60% harder rock hits. Named by miners who retired early.' },
    { id: 'mining_rig_mk4', name: 'Coreborer Mining Rig', type: 'mining', tier: 'gold', maker: 'helion',
      w: 3, h: 2, power: -20, stats: { mining: 1.2, miningDmg: 0.8 }, price: 17500,
      desc: 'Bores to the core: +120% ore yield and 80% harder rock hits.' },

    /* ---- Cloaking Array (type 'cloak') — breaks aggro, first-strike window ---- */
    { id: 'cloak_shroud', name: 'Shroud Cloaking Array', type: 'cloak', tier: 'blue', maker: 'vantia',
      w: 2, h: 2, power: -30, stats: { cloak: 1, cloakRadius: 700 }, price: 4200,
      desc: 'Stay quiet for 3s and hostiles within 700u lose your firing solution. Firing or taking a hit drops the cloak.' },
    { id: 'cloak_phantom', name: 'Phantom Cloaking Array', type: 'cloak', tier: 'purple', maker: 'vantia',
      w: 2, h: 2, power: -45, stats: { cloak: 1, cloakRadius: 850 }, price: 9800,
      desc: 'A deeper shroud over 850u. Slip a patrol line, line up the first strike, then vanish again.' },
    { id: 'cloak_wraith', name: 'Wraith Cloaking Array', type: 'cloak', tier: 'gold', maker: 'vantia',
      w: 3, h: 2, power: -60, stats: { cloak: 1, cloakRadius: 1000 }, price: 24000,
      desc: 'The full wraith treatment: a 1,000u no-fire bubble while you hold your nerve. Rare — shipwright stock only.' }
  ];
  for (var i = 0; i < defs.length; i++) {
    if (SF.PART_BY_ID[defs[i].id]) continue; // idempotent re-registration guard
    SF.PARTS.push(defs[i]);
    SF.PART_BY_ID[defs[i].id] = SF.PARTS[SF.PARTS.length - 1];
  }
})();

SF.PartSystems = (function () {
  'use strict';

  var MAX_DRONES = 4, MAX_PD = 4;
  var CLOAK_SPOOL = 3;        // s of quiet before the cloak engages
  var REACQUIRE = 1.1;        // s of enemy fire delay after a cloak drop
  var HOLD_FIRE = 0.3;        // fireTimer floor held inside the cloak radius
  var PD_COOLDOWN = 0.45;     // s per mount between projectile intercepts
  var PD_BOLT_DMG = 6, PD_BOLT_CD = 0.3, PD_BOLT_SPEED = 720;
  var DRONE_RESPAWN = 5, DRONE_ORBIT_R = 66, DRONE_ENGAGE_R = 540,
      DRONE_FIRE_R = 430, DRONE_FIRE_CD = 0.55, DRONE_BOLT_SPEED = 660;

  var ZERO = { drones: 0, droneDmg: 0, pd: 0, pdRange: 0, ecm: 0,
               sensor: 0, mining: 0, miningDmg: 0, cloak: 0, cloakRadius: 0 };
  var cache = null, cacheT = -9;
  var drones = [];
  var respawnT = 0.5;
  var pdTimers = [0, 0, 0, 0];
  var pdBoltT = 0;
  var counters = { pdZaps: 0, pdShots: 0, ecmShots: 0, mineBonusOre: 0,
                   cloakDrops: 0, sensorPings: 0 };
  var cloak = { active: false, quietT: 0, toastT: 0 };
  var sensorState = { revealed: [], t: 0, prevCd: 0, prevRt: 0 };
  var installed = { spawn: false, mining: false, sensorDraw: false, player: false };

  function nowS() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }

  /* Derived FX stats for the ACTIVE ship. buildStats() is the same funnel
   * ship.js uses for hull/shield, so what the builder shows is exactly
   * what flies. Cached 0.25s, but the cache is keyed on a signature of
   * the fitted parts: a refit (builder save, ship swap, star upgrade)
   * invalidates it instantly, so a synchronous burst of effect calls
   * right after a refit can never read the old build's stats. */
  var cacheSig = '';
  function fitSignature() {
    try {
      var P = window.SF && SF.Player;
      if (!P || !P.ships || !P.ships[P.activeShip]) return '';
      var parts = P.ships[P.activeShip].parts || [];
      var h = P.activeShip + ':' + parts.length + ':';
      for (var i = 0; i < parts.length; i++) {
        var fp = parts[i];
        h += fp.partId + '@' + fp.gx + ',' + fp.gy + ',' + (fp.stars || 1) + ';';
      }
      return h;
    } catch (e) { return ''; }
  }
  function fxStats(force) {
    var t = nowS();
    var sig = fitSignature();
    if (!force && cache && sig === cacheSig && t - cacheT < 0.25) return cache;
    var out = ZERO;
    try {
      if (window.SF && SF.Player && SF.Player.buildStats) {
        var s = SF.Player.buildStats();
        out = { drones: s.drones || 0, droneDmg: s.droneDmg || 0,
                pd: s.pd || 0, pdRange: s.pdRange || 0, ecm: s.ecm || 0,
                sensor: s.sensor || 0, mining: s.mining || 0,
                miningDmg: s.miningDmg || 0, cloak: s.cloak || 0,
                cloakRadius: s.cloakRadius || 0 };
      }
    } catch (e) { out = ZERO; }
    cache = out; cacheT = t; cacheSig = sig;
    return out;
  }

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function enemies() { return (window.SF && SF.Enemies && SF.Enemies.list) || []; }
  function player() { return window.SF && SF.Player; }

  /* ---------- targetability: mirror the wingman Guard rules ---------- */
  function targetable(e, P) {
    if (!e || e.dead || e.adrift || !(e.hp > 0)) return false;
    if (e.trader || e.escort) return false;
    if (e.playerAggro || e.raidSt || e.boss) return true;
    try {
      if (e.faction && window.SF && SF.Factions && SF.Factions.stance &&
          SF.Factions.stance(e.faction) === 'hostile') return true;
    } catch (x) { /* stance unavailable: fall through */ }
    return !e.faction;
  }

  /* ---------------- cloaking array ---------------- */
  function dropCloak(reason) {
    cloak.quietT = 0;
    if (!cloak.active) return;
    cloak.active = false;
    counters.cloakDrops++;
    var P = player(); if (!P) return;
    var st = fxStats();
    var R = st.cloakRadius || 850, R2 = R * R;
    var list = enemies();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.boss || e.raidSt) continue;
      if (dist2(e.x, e.y, P.x, P.y) > R2) continue;
      if (e.fireTimer !== undefined) e.fireTimer = Math.max(e.fireTimer || 0, REACQUIRE);
    }
    if (reason === 'damage' && cloak.toastT <= 0 && window.SF && SF.HUD && SF.HUD.toast) {
      SF.HUD.toast('👻 Cloak dropped — taking fire!');
      cloak.toastT = 6;
    }
  }

  function tickCloak(dt, st) {
    if (cloak.toastT > 0) cloak.toastT -= dt;
    if (!st.cloak) { cloak.active = false; cloak.quietT = 0; return; }
    if (!cloak.active) {
      cloak.quietT += dt;
      if (cloak.quietT >= CLOAK_SPOOL) cloak.active = true;
      return;
    }
    var P = player();
    var R = st.cloakRadius || 850, R2 = R * R;
    var list = enemies();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.boss || e.raidSt) continue; // bosses/raid wings see through it
      if (dist2(e.x, e.y, P.x, P.y) > R2) continue;
      if (e.playerAggro) e.playerAggro = false;
      if (e.fireTimer !== undefined && e.fireTimer < HOLD_FIRE) e.fireTimer = HOLD_FIRE;
    }
  }

  function onPlayerFired() { dropCloak('fire'); }

  /* ---------------- drone bay ---------------- */
  function spawnDrone(st, P) {
    var a = Math.random() * Math.PI * 2;
    drones.push({
      x: P.x + Math.cos(a) * DRONE_ORBIT_R, y: P.y + Math.sin(a) * DRONE_ORBIT_R,
      vx: 0, vy: 0, angle: a, fireT: Math.random() * 0.3,
      orbit: Math.random() * Math.PI * 2,
      hp: 24 + (st.droneDmg || 0) * 2, maxHp: 24 + (st.droneDmg || 0) * 2
    });
  }

  function tickDrones(dt, st) {
    var P = player();
    var want = Math.min(MAX_DRONES, Math.floor(st.drones || 0));
    while (drones.length > want) drones.pop();
    if (drones.length < want) {
      respawnT -= dt;
      if (respawnT <= 0) {
        spawnDrone(st, P);
        /* filling the bay is fast (0.7s rails); only a drone LOST in
         * combat imposes the full DRONE_RESPAWN delay, set at its death
         * later in this same update pass */
        respawnT = 0.7;
      }
    } else if (respawnT > 1.2) respawnT = 1.2;

    var list = enemies();
    var pool = (window.SF && SF.Projectiles && SF.Projectiles.pool) || [];
    var pSpeed = Math.sqrt((P.vx || 0) * (P.vx || 0) + (P.vy || 0) * (P.vy || 0));
    var maxSp = Math.max(330, pSpeed * 1.2 + 70);

    for (var i = drones.length - 1; i >= 0; i--) {
      var d = drones[i];
      // nearest targetable hostile, measured from the PLAYER (drones defend it)
      var tgt = null, best = DRONE_ENGAGE_R * DRONE_ENGAGE_R;
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!targetable(e, P)) continue;
        var dd = dist2(e.x, e.y, P.x, P.y);
        if (dd < best) { best = dd; tgt = e; }
      }
      // anchor: standoff point between player and target, else orbit slot
      var ax, ay;
      if (tgt) {
        var ta = Math.atan2(tgt.y - P.y, tgt.x - P.x);
        ax = P.x + Math.cos(ta) * 165; ay = P.y + Math.sin(ta) * 165;
      } else {
        d.orbit += dt * 0.8;
        ax = P.x + Math.cos(d.orbit + i * 2.1) * DRONE_ORBIT_R;
        ay = P.y + Math.sin(d.orbit + i * 2.1) * DRONE_ORBIT_R;
      }
      var dvx = (ax - d.x) * 2.2, dvy = (ay - d.y) * 2.2;
      var dsp = Math.sqrt(dvx * dvx + dvy * dvy);
      if (dsp > maxSp) { dvx = dvx / dsp * maxSp; dvy = dvy / dsp * maxSp; }
      var blend = Math.min(1, 6 * dt);
      d.vx += (dvx - d.vx) * blend; d.vy += (dvy - d.vy) * blend;
      d.x += d.vx * dt; d.y += d.vy * dt;
      var face = tgt || null;
      d.angle = face ? Math.atan2(face.y - d.y, face.x - d.x)
                     : Math.atan2(d.vy, d.vx);

      // fire on the target — with target leading: a strafing ship covers
      // ~45u during a bolt's flight, so pure-pursuit aim almost never lands
      // (measured: 1 hit in 15 bolts). The drone's targeting computer leads
      // by the bolt's time-of-flight; a target that changes course still
      // dodges, a steady strafe does not.
      if (tgt && st.droneDmg > 0) {
        d.fireT -= dt;
        var td2 = dist2(tgt.x, tgt.y, d.x, d.y);
        if (d.fireT <= 0 && td2 < DRONE_FIRE_R * DRONE_FIRE_R) {
          d.fireT = DRONE_FIRE_CD;
          var tof = Math.sqrt(td2) / DRONE_BOLT_SPEED;
          var lx = tgt.x + (tgt.vx || 0) * tof, ly = tgt.y + (tgt.vy || 0) * tof;
          SF.Projectiles.spawn(d.x, d.y,
            Math.atan2(ly - d.y, lx - d.x) + (Math.random() - 0.5) * 0.06,
            DRONE_BOLT_SPEED, st.droneDmg, true, '#8fd0ff', { radius: 3, life: 1.1 });
        }
      }
      // hostile projectiles can kill a drone (it is a real target)
      for (var k = 0; k < pool.length; k++) {
        var pr = pool[k];
        if (!pr.active || pr.friendly) continue;
        var rr = 11 + (pr.radius || 4);
        if (dist2(pr.x, pr.y, d.x, d.y) < rr * rr) {
          pr.active = false;
          d.hp -= pr.dmg || 5;
          if (window.SF && SF.Particles) SF.Particles.burst(d.x, d.y, '#8fd0ff', 4, 130, 0.25, 2);
        }
      }
      // enemy contact grind
      for (var m = 0; m < list.length; m++) {
        var en = list[m];
        if (!en || en.dead || !(en.hp > 0)) continue;
        var cr = (en.radius || 18) + 10;
        if (dist2(en.x, en.y, d.x, d.y) < cr * cr) d.hp -= 26 * dt;
      }
      if (d.hp <= 0) {
        if (window.SF && SF.Particles) SF.Particles.explosion(d.x, d.y, 0.5, false);
        drones.splice(i, 1);
        respawnT = DRONE_RESPAWN;
      }
    }
  }

  /* ---------------- point-defense ---------------- */
  function tickPD(dt, st) {
    var mounts = Math.min(MAX_PD, Math.floor(st.pd || 0));
    if (!mounts || !(st.pdRange > 0)) return;
    var P = player();
    var i;
    for (i = 0; i < MAX_PD; i++) if (pdTimers[i] > 0) pdTimers[i] -= dt;
    var pool = (window.SF && SF.Projectiles && SF.Projectiles.pool) || [];
    var R2 = st.pdRange * st.pdRange;
    for (var mIdx = 0; mIdx < mounts; mIdx++) {
      if (pdTimers[mIdx] > 0) continue;
      var victim = null, vScore = -1;
      for (var j = 0; j < pool.length; j++) {
        var pr = pool[j];
        if (!pr.active || pr.friendly || pr.mine) continue;
        if (dist2(pr.x, pr.y, P.x, P.y) > R2) continue;
        // homing ordnance first, then whatever is closest to impact
        var score = (pr.homing || pr.kind === 'missile' ? 100000 : 0) - dist2(pr.x, pr.y, P.x, P.y);
        if (score > vScore) { vScore = score; victim = pr; }
      }
      if (victim) {
        victim.active = false;
        pdTimers[mIdx] = PD_COOLDOWN;
        counters.pdZaps++;
        if (window.SF && SF.Particles) SF.Particles.explosion(victim.x, victim.y, 0.22, false);
        if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('hit');
      }
    }
    // anti-drone fire: plink carrier drones inside the bubble
    pdBoltT -= dt;
    if (pdBoltT <= 0) {
      var list = enemies(), td = null;
      for (var q = 0; q < list.length; q++) {
        var en = list[q];
        if (en && en.type === 'drone' && !en.dead && en.hp > 0 &&
            dist2(en.x, en.y, P.x, P.y) <= R2) { td = en; break; }
      }
      if (td) {
        pdBoltT = PD_BOLT_CD;
        counters.pdShots++;
        var lead = 0.22;
        SF.Projectiles.spawn(P.x, P.y,
          Math.atan2(td.y + (td.vy || 0) * lead - P.y, td.x + (td.vx || 0) * lead - P.x),
          PD_BOLT_SPEED, PD_BOLT_DMG, true, '#ffd23f', { radius: 2, life: 0.5 });
      } else pdBoltT = 0.1;
    }
  }

  /* ---------------- sensor/ECM: extended survey reveal ---------------- */
  function tickSensor(dt, st) {
    if (sensorState.t > 0) {
      sensorState.t -= dt;
      if (sensorState.t <= 0) sensorState.revealed = [];
    }
    var S = window.SF && SF.Survey;
    if (!S || !S.testState) return;
    var ts = null;
    try { ts = S.testState(); } catch (e) { return; }
    if (!ts) return;
    var pinged = (ts.cooldown > sensorState.prevCd + 0.05) ||
                 (ts.revealT > sensorState.prevRt + 0.5);
    sensorState.prevCd = ts.cooldown || 0;
    sensorState.prevRt = ts.revealT || 0;
    if (!pinged || !(st.sensor > 0)) return;
    var P = player();
    var base = S.PING_RANGE || 1100;
    var ext = base * (1 + st.sensor), ext2 = ext * ext, base2 = base * base;
    var list = (window.SF && SF.Asteroids && SF.Asteroids.list) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || a.dead) continue;
      var dd = dist2(a.x, a.y, P.x, P.y);
      if (dd <= base2 || dd > ext2) continue;
      var rich = false;
      try { rich = S.richness(a) >= (S.RICH_MIN || 0.6); } catch (e) { rich = false; }
      out.push({ a: a, tier: rich ? 'rich' : 'common' });
    }
    sensorState.revealed = out;
    sensorState.t = S.REVEAL_DUR || 8;
    counters.sensorPings++;
  }

  function drawSensorPips(ctx) {
    if (sensorState.t <= 0 || !sensorState.revealed.length) return;
    ctx.save();
    for (var i = 0; i < sensorState.revealed.length; i++) {
      var r = sensorState.revealed[i];
      if (!r.a || r.a.dead) continue;
      ctx.save();
      ctx.translate(r.a.x, r.a.y - r.a.r - 13);
      ctx.rotate(Math.PI / 4);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = r.tier === 'rich' ? '#4de3ff' : '#9aa3b2';
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------- drawing: drones + cloak ring ---------------- */
  function drawSystems(ctx) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
    var P = player(); if (!P) return;
    var i, d;
    for (i = 0; i < drones.length; i++) {
      d = drones[i];
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      ctx.fillStyle = '#0d1520';
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8fd0ff';
      ctx.fillRect(2, -1.5, 4, 3);
      ctx.restore();
      if (d.hp < d.maxHp) {
        ctx.save();
        ctx.strokeStyle = 'rgba(143,208,255,.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (d.hp / d.maxHp));
        ctx.stroke();
        ctx.restore();
      }
    }
    var st = fxStats();
    if (st.cloak) {
      var R = (P.radius || 18) + 9;
      ctx.save();
      ctx.translate(P.x, P.y);
      if (cloak.active) {
        var pulse = 0.55 + 0.25 * Math.sin(nowS() * 3);
        ctx.strokeStyle = 'rgba(179,136,255,' + pulse.toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      } else if (cloak.quietT > 0.15) {
        ctx.strokeStyle = 'rgba(179,136,255,.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cloak.quietT / CLOAK_SPOOL));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- master tick ---------------- */
  function resetTransient() {
    drones.length = 0;
    cloak.active = false; cloak.quietT = 0;
    sensorState.revealed = []; sensorState.t = 0;
    respawnT = 0.5;
  }

  function tick(dt) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') { resetTransient(); return; }
    var P = player();
    if (!P || P.alive === false) { resetTransient(); return; }
    var st = fxStats(true);
    tickCloak(dt, st);
    tickDrones(dt, st);
    tickPD(dt, st);
    tickSensor(dt, st);
  }

  /* ---------------- wrap installation ---------------- */
  function installSpawnWrap() {
    var Pr = window.SF && SF.Projectiles;
    if (!Pr || typeof Pr.spawn !== 'function' || Pr.spawn.__partSysEcm) return;
    var base = Pr.spawn;
    var wrapped = function (x, y, angle, speed, dmg, friendly, color, opts) {
      var st = fxStats();
      if (!friendly && st.ecm > 0) {
        // triangular deviation: mean 0, typical |dev| = ecm/3, max = ecm
        angle = angle + (Math.random() + Math.random() - 1) * st.ecm;
        counters.ecmShots++;
        var p = base.call(Pr, x, y, angle, speed, dmg, friendly, color, opts);
        if (p && p.homing) p.turn *= Math.max(0.35, 1 - st.ecm * 1.6);
        return p;
      }
      return base.call(Pr, x, y, angle, speed, dmg, friendly, color, opts);
    };
    wrapped.__partSysEcm = true;
    Pr.spawn = wrapped;
    installed.spawn = true;
  }

  function installMiningWrap() {
    var A = window.SF && SF.Asteroids;
    if (!A || typeof A.damage !== 'function' || A.damage.__partSysMining) return;
    var base = A.damage;
    var wrapped = function (a, dmg, isBeam) {
      var st = fxStats();
      var mult = st.miningDmg > 0 ? 1 + st.miningDmg : 1;
      var wasDead = !!(a && a.dead);
      var wasML = !!(a && a._surveyML); // motherlode pays through Survey
      var counted = 0, origSpawn = null;
      if (st.mining > 0 && !wasML && window.SF && SF.Pickups &&
          typeof SF.Pickups.spawnOre === 'function') {
        origSpawn = SF.Pickups.spawnOre;
        SF.Pickups.spawnOre = function (x, y, n) {
          counted += (n || 1);
          return origSpawn.call(SF.Pickups, x, y, n);
        };
      }
      var r;
      try { r = base.call(A, a, dmg * mult, isBeam); }
      finally { if (origSpawn) SF.Pickups.spawnOre = origSpawn; }
      if (origSpawn && !wasDead && a && a.dead && counted > 0) {
        var extra = Math.round(counted * st.mining);
        for (var i = 0; i < extra; i++)
          origSpawn.call(SF.Pickups, a.x + (Math.random() - 0.5) * a.r,
                                     a.y + (Math.random() - 0.5) * a.r, 1);
        counters.mineBonusOre += extra;
      }
      return r;
    };
    wrapped.__partSysMining = true;
    A.damage = wrapped;
    installed.mining = true;
  }

  function installSensorDraw() {
    var A = window.SF && SF.Asteroids;
    if (!A || typeof A.draw !== 'function' || A.draw.__partSysSensor) return;
    var base = A.draw;
    var wrapped = function (ctx) {
      var r = base.call(A, ctx);
      try { drawSensorPips(ctx); } catch (e) { /* pips are cosmetic */ }
      return r;
    };
    wrapped.__partSysSensor = true;
    A.draw = wrapped;
    installed.sensorDraw = true;
  }

  function installPlayerWraps(tries) {
    var P = window.SF && SF.Player;
    var A = window.SF && SF.Audio;
    var okP = P && typeof P.update === 'function' && typeof P.draw === 'function' &&
              typeof P.takeDamage === 'function';
    var okA = A && typeof A.weaponSound === 'function';
    if (okP && okA) {
      if (!P.update.__partSysTick) {
        var bu = P.update;
        var wu = function () {
          var r = bu.apply(this, arguments);
          try { tick(arguments[0] || 0); } catch (e) { /* systems never break flight */ }
          return r;
        };
        wu.__partSysTick = true;
        P.update = wu;
      }
      if (!P.draw.__partSysDraw) {
        var bd = P.draw;
        var wd = function () {
          var r = bd.apply(this, arguments);
          try { drawSystems(arguments[0]); } catch (e) { /* cosmetic only */ }
          return r;
        };
        wd.__partSysDraw = true;
        P.draw = wd;
      }
      if (!P.takeDamage.__partSysCloak) {
        var bt = P.takeDamage;
        var wt = function () {
          var r = bt.apply(this, arguments);
          try { if (cloak.active) dropCloak('damage'); cloak.quietT = 0; } catch (e) {}
          return r;
        };
        wt.__partSysCloak = true;
        P.takeDamage = wt;
      }
      if (!A.weaponSound.__partSysCloak) {
        var bw = A.weaponSound;
        var ww = function () {
          var r = bw.apply(this, arguments);
          try { onPlayerFired(); } catch (e) {}
          return r;
        };
        ww.__partSysCloak = true;
        A.weaponSound = ww;
      }
      installed.player = true;
      return;
    }
    if ((tries || 0) < 240)
      setTimeout(function () { installPlayerWraps((tries || 0) + 1); }, 500);
  }

  installSpawnWrap();
  installMiningWrap();
  installSensorDraw();
  installPlayerWraps(0);

  return {
    installed: installed,
    stats: function () { return fxStats(true); },
    isCloaked: function () { return cloak.active; },
    testState: function () {
      return {
        installed: { spawn: installed.spawn, mining: installed.mining,
                     sensorDraw: installed.sensorDraw, player: installed.player },
        stats: fxStats(true),
        dronesActive: drones.length,
        droneHp: drones.map(function (d) { return Math.round(d.hp); }),
        pdZaps: counters.pdZaps, pdShots: counters.pdShots,
        ecmShots: counters.ecmShots, mineBonusOre: counters.mineBonusOre,
        cloakDrops: counters.cloakDrops, sensorPings: counters.sensorPings,
        cloaked: cloak.active, cloakQuietT: Math.round(cloak.quietT * 100) / 100,
        sensorRevealed: sensorState.revealed.length, sensorT: sensorState.t
      };
    },
    testReset: function () {
      counters = { pdZaps: 0, pdShots: 0, ecmShots: 0, mineBonusOre: 0,
                   cloakDrops: 0, sensorPings: 0 };
      pdTimers = [0, 0, 0, 0];
      pdBoltT = 0;
      resetTransient();
      cache = null; cacheT = -9; cacheSig = '';
    }
  };
})();

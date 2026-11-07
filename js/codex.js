/* ============================================================
 * STARFALL — codex-bestiary phase: Ship + Enemy Codex (Bestiary)
 *
 * SF.CodexBestiary: unlock-on-first-encounter bestiary entries for
 * ship classes, enemy types, elite variants and bosses. Every entry
 * shows stats, a loot-table summary and the player's kill count
 * (ship classes show PILOTED status instead of kills).
 *
 * Rosters are read live from js/data.js (SF.SHIP_CLASSES,
 * SF.CONFIG.enemies, SF.ELITE_VARIANTS, SF.CONFIG.bosses) plus the
 * runtime entity shapes from js/enemies.js — no hardcoded rosters.
 *
 * WIRING (no other-phase files edited — everything wraps public APIs):
 *   encounters -> SF.Enemies.spawn wrap, plus a 2.5s reconcile scan that
 *                 also catches boss spawns (SF.Bosses.spawnBoss bypasses
 *                 SF.Enemies.spawn) and any exotic spawn path.
 *   kills      -> SF.Enemies.kill wrap (boss kills route through it too).
 *   ship class -> activeShip setter wrap + SF.Game.newGame wrap + a dock
 *                 reconcile over owned ships.
 *   station UI -> SF.Station.renderStore wrap + a MutationObserver on
 *                 #store-body (covers station.js internal re-renders that
 *                 call the private render() closure) inject a 📖 CODEX
 *                 button. No station.js edits.
 *   codex UI   -> attaches to the codex-journal SF.Codex (campaign.js):
 *                 wraps render() to append the BESTIARY section and
 *                 counts() to include bestiary totals. Standalone
 *                 #overlay-bestiary fallback if the journal is absent.
 *
 * Save: additive `bestiary` {seen:{}, kills:{}} sub-blob on the serialized
 * player object via SF.Player.serialize/deserialize wraps (defensive
 * reads everywhere; old saves lazily get an empty bestiary) — save-neutral,
 * NO SF.SAVE_VERSION bump. Kill counts increment additively and persist
 * through the normal save path (immediate save on unlock, throttled
 * 30s save on kill-count dirt).
 *
 * LOADING: self-bootstrapping via the document.write pattern that
 * skills-system-retry used (see the IIFE below): guarded + idempotent, so
 * a later real <script> tag wins and this becomes a no-op. The FIRST load
 * still needs one loader line — see REPORT.md "Notes for next phase".
 * ============================================================ */

/* Self-bootstrap (skills-system-retry pattern): synchronously load
 * js/codex.js during the initial parse. Guarded + idempotent. */
(function () {
  if (window.SF && window.SF.CodexBestiary) return; // already loaded: no-op
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.write('<script src="js/codex.js"><\/script>');
  }
})();

(function () {
  'use strict';
  if (window.SF && window.SF.CodexBestiary) return; // double-load guard
  var SF = window.SF = window.SF || {};

  /* ---------------- persistence (additive, save-neutral) ---------------- */

  // Runtime bestiary state lives on the SF.Player facade (NOT the private P
  // closure, so ship.js create() can't wipe it — we reset it explicitly).
  function runtime() {
    if (!SF.Player) return null;
    var b = SF.Player.bestiary;
    if (!b || typeof b !== 'object') { b = { seen: {}, kills: {} }; SF.Player.bestiary = b; }
    if (!b.seen || typeof b.seen !== 'object') b.seen = {};
    if (!b.kills || typeof b.kills !== 'object') b.kills = {};
    return b;
  }

  function sanitizeCounts(kills) {
    var out = {};
    if (kills && typeof kills === 'object') {
      Object.keys(kills).forEach(function (k) {
        var n = Math.floor(Number(kills[k]));
        if (isFinite(n) && n > 0) out[k] = n;
      });
    }
    return out;
  }

  var dirtyKills = false, lastKillSave = 0;
  function markDirty() { dirtyKills = true; }
  function throttledSave() {
    if (!dirtyKills) return;
    var now = Date.now();
    if (now - lastKillSave < 30000) return;
    lastKillSave = now; dirtyKills = false;
    try { if (SF.Save) SF.Save.save(); } catch (e) {}
  }

  /* ---------------- catalogs (read live from game data) ---------------- */

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (typeof text === 'string') d.textContent = text;
    return d;
  }

  function pct(n) { return Math.round(n * 100) + '%'; }

  function weightedNames(weights, items) {
    var total = 0, i, out = [];
    for (i = 0; i < weights.length; i++) total += weights[i] || 0;
    if (total <= 0) return '';
    for (i = 0; i < weights.length && i < items.length; i++) {
      if (weights[i] > 0) out.push(items[i].name + ' ' + Math.round(weights[i] / total * 100) + '%');
    }
    return out.join(' / ');
  }

  function weaponName(id) {
    var w = SF.WEAPON_BY_ID && SF.WEAPON_BY_ID[id];
    return w ? w.name : id;
  }
  function modName(id) {
    var m = SF.MOD_BY_ID && SF.MOD_BY_ID[id];
    return m ? m.name : id;
  }

  /* Loot-table summary for a base enemy type id. */
  function lootSummary(id) {
    var spec = (SF.CONFIG && SF.CONFIG.enemies && SF.CONFIG.enemies[id]) || null;
    if (!spec) return 'No loot data.';
    var parts = [];
    parts.push('Credits ' + spec.creditsMin + '–' + spec.creditsMax);
    if (spec.oreMax > 0) parts.push('Ore ' + spec.oreMin + '–' + spec.oreMax);
    if (spec.itemChance > 0 && SF.ITEM_DROPS && SF.ITEM_DROPS[id] && SF.ITEMS) {
      var wn = weightedNames(SF.ITEM_DROPS[id], SF.ITEMS);
      parts.push(pct(spec.itemChance) + ' component' + (wn ? ' (' + wn + ')' : ''));
    }
    var wc = (SF.CONFIG.weaponDrops || {})[id];
    if (wc > 0 && SF.WEAPON_DROPS && SF.WEAPON_DROPS[id]) {
      parts.push(pct(wc) + ' weapon: ' + SF.WEAPON_DROPS[id].map(weaponName).join(', '));
    }
    var mc = (SF.CONFIG.modDrops || {})[id];
    if (mc > 0 && SF.MOD_DROPS && SF.MOD_DROPS[id]) {
      parts.push(pct(mc) + ' mod: ' + SF.MOD_DROPS[id].map(modName).join(', '));
    }
    var pc = (SF.CONFIG.partDrops || {})[id];
    if (pc > 0) parts.push(pct(pc) + ' ship part (white/green)');
    return parts.join(' · ');
  }

  function foeSystems(id) {
    var sys = [];
    (SF.SYSTEMS || []).forEach(function (s) {
      (s.enemyTable || []).forEach(function (e) {
        if (e[0] === id && sys.indexOf(s.name) < 0) sys.push(s.name);
      });
    });
    return sys.length ? 'Patrols: ' + sys.join(', ') : '';
  }

  function foeStats(id) {
    var s = (SF.CONFIG && SF.CONFIG.enemies && SF.CONFIG.enemies[id]) || {};
    var p = ['HP ' + s.hp, 'Speed ' + s.speed, 'Hull radius ' + s.radius];
    if (s.boltDamage) p.push('Guns: ' + s.boltDamage + ' dmg bolts every ' + (s.fireInterval || '?') + 's' +
      (s.homing ? ' (homing)' : ''));
    p.push('Contact ' + s.contact + ' dmg');
    if (s.automated) p.push('Automated — no crew, cannot be boarded');
    else if (s.crew) p.push('Crew ' + s.crew + (s.crewStars ? ' (' + s.crewStars[0] + '–' + s.crewStars[1] + '★)' : ''));
    var prof = (SF.CONFIG.aiProfiles || {})[id];
    if (prof && prof.kind) p.push('AI: ' + prof.kind + (prof.flank ? ' (flanking)' : ''));
    return p.join(' · ');
  }

  function shipDefs() {
    return (SF.SHIP_CLASSES || []).map(function (c) {
      return {
        key: 'ship:' + c.id, cat: 'ship', id: c.id,
        title: c.name, color: c.color || '#9fd8ff',
        hint: 'Buy or capture a ' + c.name + '-class hull',
        stats: 'Grid ' + c.gridW + '×' + c.gridH + ' · Speed ' + c.speed +
               ' · Hull ' + c.hull + ' · Shield ' + c.shield,
        detail: 'Crew required: ' + c.crewReq + ' · Cargo bonus: +' + c.cargoBonus + 't' +
                ' · Shipyard price: ' + c.price + 'cr\n\n' + (c.desc || '')
      };
    });
  }

  function foeDefs() {
    var cfg = (SF.CONFIG && SF.CONFIG.enemies) || {};
    var ids = Object.keys(cfg).filter(function (id) { return cfg[id] && !cfg[id].boss; });
    // stable order: drone, raider, gunship first, then anything new
    var order = { drone: 0, raider: 1, gunship: 2 };
    ids.sort(function (a, b) {
      var oa = (order[a] === undefined) ? 99 : order[a];
      var ob = (order[b] === undefined) ? 99 : order[b];
      return oa - ob || (a < b ? -1 : 1);
    });
    var colors = { drone: '#9fd8ff', raider: '#ffb35e', gunship: '#ff5e3a' };
    return ids.map(function (id) {
      var s = cfg[id];
      var sys = foeSystems(id);
      return {
        key: 'foe:' + id, cat: 'foe', id: id,
        title: s.scoreName || id, color: colors[id] || '#cfe3ff',
        hint: 'Survive an encounter',
        stats: foeStats(id),
        detail: (sys ? sys + '\n\n' : '') + 'LOOT — ' + lootSummary(id)
      };
    });
  }

  function eliteDefs() {
    var V = SF.ELITE_VARIANTS || {};
    return Object.keys(V).map(function (id) {
      var vd = V[id];
      var ed = (SF.CONFIG && SF.CONFIG.eliteDrops) || {};
      var rates = SF.CONFIG.eliteRate || {};
      var spawn = Object.keys(rates).filter(function (s) { return rates[s] > 0; })
        .map(function (s) {
          var sys = SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[s];
          return (sys ? sys.name : s) + ' ~1/' + Math.round(1 / rates[s]);
        }).join(', ');
      return {
        key: 'elite:' + id, cat: 'elite', id: id,
        title: vd.name + ' (Elite)', color: vd.aura || '#b45cff',
        hint: 'Cross an elite patrol',
        stats: 'Hull ×' + vd.hullMul + ' · Speed ×' + vd.speedMul + ' · Bounty ×' + vd.creditMul,
        detail: 'Elite variant that can roll on any pirate hull (never on faction patrols).' +
          (spawn ? '\nSpawn rate: ' + spawn + ' patrols' : '') +
          '\nNamed pilots: ' + (vd.names || []).slice(0, 4).join(', ') +
          '\n\nLOOT — guaranteed elite-weighted component' +
          (ed.weaponChance ? ', ' + pct(ed.weaponChance) + ' weapon (base-type table)' : '') +
          (ed.modChance ? ', ' + pct(ed.modChance) + ' mod' : '') +
          (ed.partChance ? ', ' + pct(ed.partChance) + ' green/blue/purple part' : '') +
          ' · +' + (SF.CONFIG.eliteStanding || 4) + ' local-faction standing'
      };
    });
  }

  function bossDefs() {
    var B = (SF.CONFIG && SF.CONFIG.bosses) || {};
    return Object.keys(B).map(function (id) {
      var d = B[id];
      var sys = (SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[d.systemId] && SF.SYSTEM_BY_ID[d.systemId].name) || d.systemId;
      var item = (SF.ITEM_BY_ID && SF.ITEM_BY_ID[d.dropItem]) || { name: d.dropItem };
      return {
        key: 'boss:' + id, cat: 'boss', id: id,
        title: d.name, color: d.color || '#ff5e3a',
        hint: 'Face the ' + sys + ' capital ship',
        stats: d.title + ' · HP ' + d.hp + ' · Speed ' + d.speed,
        detail: (d.blurb || '') +
          '\n\nAttacks: ' + (d.attacks || []).join(' → ') +
          ' (telegraph ' + d.telegraph + 's). Never flees, holds range.' +
          '\n\nREWARD — ' + d.creditReward[0] + '–' + d.creditReward[1] + 'cr, guaranteed ' +
          item.name + ' + ' + weaponName(d.dropWeapon) +
          ', +' + d.stand + ' ' + d.standFaction + ' standing, ' +
          (d.karma >= 0 ? '+' : '') + d.karma + ' karma'
      };
    });
  }

  var DEF_CACHE = null;
  function allDefs() {
    if (!DEF_CACHE) {
      DEF_CACHE = shipDefs().concat(foeDefs(), eliteDefs(), bossDefs());
    }
    return DEF_CACHE;
  }
  function defMap() {
    var m = {};
    allDefs().forEach(function (d) { m[d.key] = d; });
    return m;
  }

  /* ---------------- unlock + kill counting ---------------- */

  function isUnlocked(key) {
    try {
      var b = runtime();
      return !!(b && b.seen[key]);
    } catch (e) { return false; }
  }

  function unlockKey(key) {
    var defs = defMap();
    var def = defs[key];
    if (!def) return false;
    var b;
    try { b = runtime(); } catch (e) { b = null; }
    if (!b || b.seen[key]) return false;
    b.seen[key] = Date.now();
    markDirty();
    try {
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('📖 Bestiary: ' + def.title + ' catalogued');
    } catch (e) {}
    try { if (SF.Save) SF.Save.save(); } catch (e) {}
    return true;
  }

  function addKill(key) {
    var defs = defMap();
    if (!defs[key]) return;
    var b;
    try { b = runtime(); } catch (e) { b = null; }
    if (!b) return;
    if (!b.seen[key]) { try { unlockKey(key); } catch (e) {} }
    b.kills[key] = (b.kills[key] | 0) + 1;
    markDirty();
  }

  function killCount(key) {
    try {
      var b = runtime();
      return (b && b.kills[key]) | 0;
    } catch (e) { return 0; }
  }

  function counts() {
    var defs = allDefs(), u = 0, i;
    for (i = 0; i < defs.length; i++) if (isUnlocked(defs[i].key)) u++;
    return { unlocked: u, total: defs.length };
  }

  /* ---------------- rendering ---------------- */

  var _openIdx = 0;

  function bestiaryRow(def) {
    var unlocked = isUnlocked(def.key);
    var row = el('div', 'store-row', null);
    row.setAttribute('data-bestiary', def.key);
    row.style.cssText = 'cursor:' + (unlocked ? 'pointer' : 'default') + ';' +
      (unlocked ? '' : 'opacity:0.55;');
    var info = el('div', 'store-info', null);
    var name = el('div', 'store-name', unlocked ? def.title : '???');
    if (!unlocked) name.style.letterSpacing = '4px';
    else if (def.color) name.style.color = def.color;
    var sub = el('div', 'store-desc', unlocked ? def.stats : ('Undiscovered — ' + def.hint + '.'));
    info.appendChild(name);
    info.appendChild(sub);
    row.appendChild(info);
    if (unlocked) {
      var full = el('div', 'store-desc', null);
      full.style.cssText = 'display:none;margin-top:6px;white-space:pre-wrap;color:#cfe3ff;';
      var tail = (def.cat === 'ship') ? '\nStatus: PILOTED ✓'
                                     : '\nKills: ' + killCount(def.key);
      full.textContent = def.detail + tail;
      row.addEventListener('click', function () {
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        full.style.display = (full.style.display === 'none') ? 'block' : 'none';
      });
      info.appendChild(full);
    }
    return row;
  }

  function section(container, title, defs) {
    if (!defs.length) return;
    var h = el('div', 'store-head', title);
    h.style.cssText = 'margin:12px 0 4px;color:#7df9ff;';
    container.appendChild(h);
    defs.forEach(function (d) { container.appendChild(bestiaryRow(d)); });
  }

  /* Renders the whole bestiary (all four categories) into any container. */
  function renderBestiaryInto(container) {
    var defs = allDefs();
    var byCat = { ship: [], foe: [], elite: [], boss: [] };
    defs.forEach(function (d) { (byCat[d.cat] || (byCat[d.cat] = [])).push(d); });
    var wrap = el('div', null, null);
    wrap.className = 'bestiary-section';
    var c = counts();
    var h = el('div', 'store-head', '📖 BESTIARY — SHIPS & FOES');
    h.style.cssText = 'margin:12px 0 4px;color:#ffd23f;';
    wrap.appendChild(h);
    var sub = el('div', 'store-desc', c.unlocked + '/' + c.total + ' catalogued · entries unlock on first encounter');
    sub.style.cssText = 'margin-bottom:4px;opacity:0.75;';
    wrap.appendChild(sub);
    section(wrap, '🚀 SHIP CLASSES', byCat.ship);
    section(wrap, '☠ HOSTILES', byCat.foe);
    section(wrap, '👑 ELITE VARIANTS', byCat.elite);
    section(wrap, '🛸 CAPITAL SHIPS', byCat.boss);
    container.appendChild(wrap);
  }

  /* ---------------- station UI button ---------------- */

  function insertStationButton(body) {
    if (!body || document.getElementById('btn-codex')) return;
    var b = document.createElement('button');
    b.id = 'btn-codex';
    b.className = 'btn big ui-block';
    b.textContent = '📖 CODEX';
    b.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      try { Bestiary.open(); } catch (e) {}
    });
    body.insertBefore(b, body.firstChild);
  }

  function hookStation() {
    if (!SF.Station || SF.Station.__bestiaryHooked) return;
    SF.Station.__bestiaryHooked = true;
    // synchronous path: wrap the public renderStore
    if (typeof SF.Station.renderStore === 'function' && !SF.Station.renderStore.__bestiary) {
      var orig = SF.Station.renderStore;
      var w = function () {
        var r = orig.apply(this, arguments);
        try {
          var body = document.getElementById('store-body');
          insertStationButton(body);
        } catch (e) {}
        return r;
      };
      w.__bestiary = true;
      SF.Station.renderStore = w;
    }
    // backstop: station.js also re-renders via its private render() closure
    // (buy/sell/repair handlers) — a MutationObserver re-injects the button.
    var watch = function () {
      var body = document.getElementById('store-body');
      if (!body || body.__bestiaryWatched) return;
      body.__bestiaryWatched = true;
      try {
        new MutationObserver(function () {
          try { insertStationButton(body); } catch (e) {}
        }).observe(body, { childList: true });
      } catch (e) {}
      try { insertStationButton(body); } catch (e2) {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watch);
    } else { watch(); }
  }

  /* ---------------- enemy hooks ---------------- */

  function hookEnemies() {
    if (!SF.Enemies || SF.Enemies.__bestiaryHooked) return;
    SF.Enemies.__bestiaryHooked = true;
    // encounter unlock on spawn
    if (typeof SF.Enemies.spawn === 'function' && !SF.Enemies.spawn.__bestiary) {
      var origSpawn = SF.Enemies.spawn;
      var ws = function (typeId, x, y, mul, opts) {
        var e = origSpawn.apply(this, arguments);
        try {
          if (e && e.type && !e.boss) {
            var dm = defMap();
            if (dm['foe:' + e.type]) unlockKey('foe:' + e.type);
            if (e.elite && dm['elite:' + e.elite]) unlockKey('elite:' + e.elite);
          }
        } catch (err) {}
        return e;
      };
      ws.__bestiary = true;
      SF.Enemies.spawn = ws;
    }
    // kill counting (+ encounter backstop)
    if (typeof SF.Enemies.kill === 'function' && !SF.Enemies.kill.__bestiary) {
      var origKill = SF.Enemies.kill;
      var wk = function (e) {
        try {
          if (e) {
            var dm = defMap();
            if (e.boss && e.bossId && dm['boss:' + e.bossId]) {
              addKill('boss:' + e.bossId);
            } else if (e.type && dm['foe:' + e.type]) {
              addKill('foe:' + e.type);
              if (e.elite && dm['elite:' + e.elite]) addKill('elite:' + e.elite);
            }
          }
        } catch (err) {}
        return origKill.apply(this, arguments);
      };
      wk.__bestiary = true;
      SF.Enemies.kill = wk;
    }
  }

  /* Reconcile scan: catches boss spawns (which bypass SF.Enemies.spawn)
   * and any exotic spawn path. Also throttles kill-count saves. */
  function reconcile() {
    try {
      if (!SF.Game || SF.Game.state !== 'PLAYING') { throttledSave(); return; }
      var list = (SF.Enemies && SF.Enemies.list) || [];
      var dm = defMap();
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e) continue;
        if (e.boss && e.bossId && dm['boss:' + e.bossId]) unlockKey('boss:' + e.bossId);
        else if (e.type && dm['foe:' + e.type]) {
          unlockKey('foe:' + e.type);
          if (e.elite && dm['elite:' + e.elite]) unlockKey('elite:' + e.elite);
        }
      }
      throttledSave();
    } catch (err) {}
  }

  /* ---------------- player hooks (save-neutral persistence) ---------------- */

  function unlockShipClass() {
    try {
      var ships = SF.Player.ships, i = SF.Player.activeShip;
      var sh = ships && ships[i];
      if (sh && sh.classId) {
        var dm = defMap();
        if (dm['ship:' + sh.classId]) unlockKey('ship:' + sh.classId);
      }
    } catch (e) {}
  }

  function reconcileShips() {
    try {
      var ships = (SF.Player && SF.Player.ships) || [];
      var dm = defMap();
      for (var i = 0; i < ships.length; i++) {
        var cid = ships[i] && ships[i].classId;
        if (cid && dm['ship:' + cid]) unlockKey('ship:' + cid);
      }
    } catch (e) {}
  }

  function hookPlayer() {
    if (!SF.Player || SF.Player.__bestiaryHooked) return;
    SF.Player.__bestiaryHooked = true;

    // additive bestiary sub-blob on the serialized player object
    if (typeof SF.Player.serialize === 'function' && !SF.Player.serialize.__bestiary) {
      var origSer = SF.Player.serialize;
      var wser = function () {
        var d = origSer.apply(this, arguments);
        try {
          var b = runtime();
          d.bestiary = { seen: Object.assign({}, b.seen), kills: sanitizeCounts(b.kills) };
        } catch (e) { d.bestiary = { seen: {}, kills: {} }; }
        return d;
      };
      wser.__bestiary = true;
      SF.Player.serialize = wser;
    }
    if (typeof SF.Player.deserialize === 'function' && !SF.Player.deserialize.__bestiary) {
      var origDes = SF.Player.deserialize;
      var wdes = function (d) {
        origDes.apply(this, arguments); // runs wrapped create() -> bestiary reset
        try {
          var raw = (d && d.bestiary) || {};
          SF.Player.bestiary = {
            seen: (raw.seen && typeof raw.seen === 'object') ? Object.assign({}, raw.seen) : {},
            kills: sanitizeCounts(raw.kills)
          };
        } catch (e) { SF.Player.bestiary = { seen: {}, kills: {} }; }
      };
      wdes.__bestiary = true;
      SF.Player.deserialize = wdes;
    }
    // new pilot -> fresh bestiary (create() doesn't touch the facade field)
    if (typeof SF.Player.create === 'function' && !SF.Player.create.__bestiary) {
      var origCreate = SF.Player.create;
      var wc = function () {
        var r = origCreate.apply(this, arguments);
        try { SF.Player.bestiary = { seen: {}, kills: {} }; } catch (e) {}
        return r;
      };
      wc.__bestiary = true;
      SF.Player.create = wc;
    }
    // ship-class encounter: the activeShip setter is the switch/buy funnel
    try {
      var desc = Object.getOwnPropertyDescriptor(SF.Player, 'activeShip');
      if (desc && desc.set && !desc.set.__bestiary) {
        var origSet = desc.set;
        var wset = function (v) {
          origSet.call(this, v);
          try { unlockShipClass(); } catch (e) {}
        };
        wset.__bestiary = true;
        Object.defineProperty(SF.Player, 'activeShip', {
          get: desc.get, set: wset,
          enumerable: desc.enumerable, configurable: true
        });
      }
    } catch (e) {}
  }

  function hookGame() {
    if (!SF.Game || SF.Game.__bestiaryHooked) return;
    SF.Game.__bestiaryHooked = true;
    if (typeof SF.Game.newGame === 'function' && !SF.Game.newGame.__bestiary) {
      var orig = SF.Game.newGame;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { unlockShipClass(); } catch (e) {} // starter hull
        return r;
      };
      w.__bestiary = true;
      SF.Game.newGame = w;
    }
    /* The title-screen NEW GAME button calls main.js's closure-local
     * newGame(), not SF.Game.newGame — bind the button too (tutorial-phase
     * pattern). Deferred so the game's own handler runs first. */
    var bindBtn = function () {
      try {
        var nb = document.getElementById('btn-new');
        if (nb && !nb.__bestiaryBound) {
          nb.__bestiaryBound = true;
          nb.addEventListener('click', function () {
            setTimeout(function () { try { unlockShipClass(); } catch (e) {} }, 600);
          });
        }
      } catch (e) {}
    };
    bindBtn();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindBtn);
    }
  }

  /* ---------------- journal (codex-journal) attachment ---------------- */

  var ATTACH_FLAG = '__bestiaryAttached';

  function appendBestiarySection() {
    var body = document.getElementById('quests-body');
    if (!body) return;
    // journal render() appends its footer last — slot the bestiary before it
    var sec = el('div', null, null);
    renderBestiaryInto(sec);
    var foot = body.lastChild;
    if (foot) body.insertBefore(sec, foot);
    else body.appendChild(sec);
  }

  function attach() {
    var C = window.SF && SF.Codex;
    if (!C || C[ATTACH_FLAG]) return;
    if (typeof C.render === 'function' && !C.render.__bestiary) {
      var origRender = C.render;
      var wr = function () {
        var r = origRender.apply(this, arguments);
        try { appendBestiarySection(); } catch (e) {}
        return r;
      };
      wr.__bestiary = true;
      C.render = wr;
    }
    if (typeof C.counts === 'function' && !C.counts.__bestiary) {
      var origCounts = C.counts;
      var wc = function () {
        var c = origCounts.apply(this, arguments) || {};
        var b = counts();
        c.bestiary = b;
        c.unlocked = (c.unlocked | 0) + b.unlocked;
        c.total = (c.total | 0) + b.total;
        return c;
      };
      wc.__bestiary = true;
      C.counts = wc;
    }
    // friendly bestiary API on the codex, next to unlockStory/unlockChar/unlockLore
    C.bestiary = api;
    C.unlockBestiary = function (cat, id) {
      var map = { foe: 'foe:', elite: 'elite:', boss: 'boss:', ship: 'ship:' };
      var p = map[cat] || '';
      return unlockKey(p + id);
    };
    C[ATTACH_FLAG] = true;
  }

  /* ---------------- standalone fallback (journal absent) ---------------- */

  function ensureOverlay() {
    if (document.getElementById('overlay-bestiary')) return;
    var o = el('div', 'overlay hidden', null);
    o.id = 'overlay-bestiary';
    o.innerHTML = '<div class="panel wide"><h2>📖 CODEX</h2>' +
      '<div id="bestiary-body"></div>' +
      '<button id="btn-bestiary-close" class="btn big ui-block">CLOSE</button></div>';
    document.body.appendChild(o);
    document.getElementById('btn-bestiary-close').addEventListener('click', function () {
      if (SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack();
      if (SF.Game) SF.Game.hideOverlay('overlay-bestiary');
    });
  }

  function standaloneOpen() {
    try { reconcileShips(); } catch (e) {}
    ensureOverlay();
    var body = document.getElementById('bestiary-body');
    if (!body) return;
    body.innerHTML = '';
    renderBestiaryInto(body);
    if (SF.Game) SF.Game.showOverlay('overlay-bestiary');
  }

  /* ---------------- public API ---------------- */

  var api = {
    /* Station button + 'open the codex' entry point. Prefers the journal's
     * codex screen (bestiary renders as a section of it); falls back to a
     * standalone overlay when the journal module is absent. */
    open: function () {
      try { reconcileShips(); } catch (e) {}
      var C = window.SF && SF.Codex;
      if (C && C[ATTACH_FLAG] && typeof C.open === 'function') {
        try { C.open(); return; } catch (e) {}
      }
      standaloneOpen();
    },
    close: function () {
      try { if (SF.Game) SF.Game.hideOverlay('overlay-bestiary'); } catch (e) {}
      try {
        var C = window.SF && SF.Codex;
        if (C && typeof C.close === 'function') C.close();
      } catch (e2) {}
    },
    isUnlocked: isUnlocked,
    unlockFoe: function (id) { return unlockKey('foe:' + id); },
    unlockElite: function (id) { return unlockKey('elite:' + id); },
    unlockBoss: function (id) { return unlockKey('boss:' + id); },
    unlockShip: function (id) { return unlockKey('ship:' + id); },
    kills: killCount,
    counts: counts,
    defs: allDefs,
    reconcile: reconcile,      // test hook: run the encounter scan now
    refreshDefs: function () { DEF_CACHE = null; return allDefs(); }
  };

  var Bestiary = api;

  /* ---------------- install ---------------- */

  function install() {
    hookPlayer();
    hookEnemies();
    hookStation();
    hookGame();   // no-op until SF.Game exists (main.js may load after us)
    attach();     // no-op until the journal's SF.Codex exists
    try {
      if (!install._timer) {
        install._timer = setInterval(reconcile, 2500);
      }
    } catch (e) {}
  }

  install();
  // Late pass: covers load orders where main.js / campaign.js parse after us
  // (e.g. document.write bootstrap at the hud.js position).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try { hookGame(); } catch (e) {}
      try { attach(); } catch (e2) {}
      try { hookStation(); } catch (e3) {}
    });
  } else {
    try { hookGame(); } catch (e) {}
    try { attach(); } catch (e2) {}
  }

  SF.CodexBestiary = Bestiary;
})();

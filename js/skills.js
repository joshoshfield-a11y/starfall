/* ============================================================
 * STARFALL — skills-system-retry phase: SF.Skills
 *
 * 5 skill trees (Gunnery / Piloting / Engineering / Trading /
 * Leadership), 10 nodes each. XP from kills, mining, trading
 * profits and quest turn-ins; every level grants 2 skill points.
 *
 * WIRING (twelve-hour-wave3: the B2 placebo gaps are closed — every
 * tree now changes game state; verified by wave3 smoke.mjs):
 *   LIVE bonuses:
 *     Gunnery damage/fireRate/range -> SF.Mods.damageMul/rateMul/rangeMul
 *       (single seam read by ship.js fire() AND mods.js DPS previews)
 *     Piloting speed/handling/accel -> ship.js effectiveSpeed() (top
 *       speed), the velocity-lerp rate (accel), the turn-lerp rate
 *       (handling); SF.Player.speed() inherits via effectiveSpeed()
 *     Engineering max shield       -> ship.js private maxShield()
 *       (the facade SF.Player.maxShield delegates here — NO separate
 *       facade wrap, which would double-apply; see install())
 *     Engineering shield regen      -> ship.js update() regen rate,
 *       both the normal and adrift branches
 *     Engineering repair discount   -> station.js repairQuote() (hub
 *       repair-all) + Shipwright Repairs tab rows (hull + subsystems)
 *     Trading buy/sell prices      -> SF.Trading.price
 *     Trading cargo hold           -> SF.Player.cargoSpace
 *     Leadership crew power        -> SF.Crew.power
 *     Leadership wingman damage    -> quests.js wingman fire line
 *     Leadership hire discount     -> SF.Companions.effCost (hire(),
 *       hire-row button, hire dialogue — one price everywhere)
 *   XP sources:
 *     kills   -> SF.Quests.onKill wrap (enemies.js kill() calls it)
 *     quests  -> SF.Quests.turnIn wrap
 *     trading -> SF.Trading.buy/sell wraps (cost-basis profit tracking)
 *     mining  -> SF.Skills.onOre(n), called from pickups.js ore
 *       collection (asteroids break into ore pickups — that IS the mine
 *       event; the same call site also feeds SF.Quests.onOreMined,
 *       which previously had no call site anywhere)
 *   No tree is decorative. No skill cost, XP rate, or balance number
 *   was changed by wave3 — only call sites + effect seams were added
 *   (the percentages are the ones the trees already shipped).
 *
 * Save: v10 -> v11 (SF.Player.migrateV10 adds the skills blob;
 * serialize/deserialize/create wrapped here so ship.js stays untouched).
 * Balance: a fully-skilled 1-star weapon sits at ~1.46x damage,
 * well under a 5-star weapon's 2.0x.
 *
 * skill-prestige phase: prestige system — a fully-maxed tree can be
 * prestiged (ranks reset to 0, no refund) for a permanent stacking +4%
 * bonus to that tree's effect, capped at 5 prestiges. Star badges in the
 * UI. State is an additive `prestige` key on the skills blob; save-neutral
 * (no SAVE_VERSION bump).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------------- tree + node definitions ----------------
   * stats: flat per-rank values summed by bonus(stat).
   * req: points already spent in the tree required to unlock.
   */
  var TREES = [
    { id: 'gunnery', name: 'Gunnery', icon: '🎯', desc: 'Weapon damage, fire rate, range.',
      nodes: [
        { id: 'heavy-rounds', name: 'Heavy Rounds', icon: '💥', max: 3, req: 0, stats: { damage: 4 }, desc: '+4% weapon damage / rank.' },
        { id: 'rapid-trigger', name: 'Rapid Trigger', icon: '⚡', max: 3, req: 0, stats: { fireRate: 3 }, desc: '+3% fire rate / rank.' },
        { id: 'long-barrels', name: 'Long Barrels', icon: '📏', max: 2, req: 2, stats: { range: 8 }, desc: '+8% projectile range / rank.' },
        { id: 'armor-piercing', name: 'Armor Piercing', icon: '🔩', max: 3, req: 3, stats: { damage: 4 }, desc: '+4% weapon damage / rank.' },
        { id: 'overclocked', name: 'Overclocked Coils', icon: '🌀', max: 3, req: 4, stats: { fireRate: 3 }, desc: '+3% fire rate / rank.' },
        { id: 'tracer-feeds', name: 'Tracer Feeds', icon: '🔥', max: 2, req: 5, stats: { damage: 3, fireRate: 1 }, desc: '+3% damage, +1% fire rate / rank.' },
        { id: 'devastating', name: 'Devastating Salvo', icon: '☄', max: 2, req: 6, stats: { damage: 5 }, desc: '+5% weapon damage / rank.' },
        { id: 'trigger-discipline', name: 'Trigger Discipline', icon: '🎖', max: 2, req: 6, stats: { fireRate: 4 }, desc: '+4% fire rate / rank.' },
        { id: 'stable-platform', name: 'Stable Platform', icon: '🎛', max: 2, req: 7, stats: { range: 6 }, desc: '+6% projectile range / rank.' },
        { id: 'gunnery-mastery', name: 'Gunnery Mastery', icon: '👑', max: 2, req: 8, stats: { damage: 2, fireRate: 2 }, desc: '+2% damage, +2% fire rate / rank.' }
      ] },
    { id: 'piloting', name: 'Piloting', icon: '🧭', desc: 'Speed, handling, acceleration.',
      nodes: [
        { id: 'ion-thrusters', name: 'Ion Thrusters', icon: '🚀', max: 3, req: 0, stats: { speed: 4 }, desc: '+4% engine speed / rank.' },
        { id: 'vector-jets', name: 'Vector Jets', icon: '🛞', max: 3, req: 0, stats: { handling: 6 }, desc: '+6% turn handling / rank.' },
        { id: 'inertial-damp', name: 'Inertial Dampeners', icon: '🧲', max: 2, req: 2, stats: { accel: 8 }, desc: '+8% acceleration / rank.' },
        { id: 'afterburners', name: 'Afterburners', icon: '🔥', max: 3, req: 3, stats: { speed: 4 }, desc: '+4% engine speed / rank.' },
        { id: 'dogfight', name: 'Dogfight Instinct', icon: '🦅', max: 3, req: 4, stats: { handling: 6 }, desc: '+6% turn handling / rank.' },
        { id: 'slipstream', name: 'Slipstream', icon: '💨', max: 2, req: 6, stats: { speed: 3 }, desc: '+3% engine speed / rank.' },
        { id: 'snap-roll', name: 'Snap Roll', icon: '🎢', max: 2, req: 6, stats: { handling: 8 }, desc: '+8% turn handling / rank.' },
        { id: 'gravitic-comp', name: 'Gravitic Compensators', icon: '🪐', max: 2, req: 7, stats: { accel: 6 }, desc: '+6% acceleration / rank.' },
        { id: 'piloting-mastery', name: 'Piloting Mastery', icon: '👑', max: 2, req: 8, stats: { speed: 2, handling: 2 }, desc: '+2% speed, +2% handling / rank.' },
        { id: 'void-dancer', name: 'Void Dancer', icon: '💃', max: 2, req: 9, stats: { speed: 2, handling: 3 }, desc: '+2% speed, +3% handling / rank.' }
      ] },
    { id: 'engineering', name: 'Engineering', icon: '🔧', desc: 'Shields, regen, cheaper repairs.',
      nodes: [
        { id: 'shield-emitters', name: 'Shield Emitters', icon: '🛡', max: 3, req: 0, stats: { shield: 6 }, desc: '+6% max shield / rank.' },
        { id: 'regen-circuits', name: 'Regen Circuits', icon: '🔋', max: 3, req: 0, stats: { regen: 8 }, desc: '+8% shield regen / rank.' },
        { id: 'repair-drones', name: 'Repair Drones', icon: '🤖', max: 2, req: 2, stats: { repairDisc: 8 }, desc: '-8% repair cost / rank.' },
        { id: 'capacitor-banks', name: 'Capacitor Banks', icon: '⚡', max: 3, req: 3, stats: { shield: 5 }, desc: '+5% max shield / rank.' },
        { id: 'fast-regen', name: 'Fast Regen', icon: '💫', max: 3, req: 4, stats: { regen: 8 }, desc: '+8% shield regen / rank.' },
        { id: 'nanite-weave', name: 'Nanite Weave', icon: '🧬', max: 2, req: 6, stats: { repairDisc: 8 }, desc: '-8% repair cost / rank.' },
        { id: 'overcharge', name: 'Overcharge', icon: '💥', max: 2, req: 6, stats: { shield: 4, regen: 6 }, desc: '+4% shield, +6% regen / rank.' },
        { id: 'patch-kits', name: 'Patch Kits', icon: '🩹', max: 2, req: 7, stats: { repairDisc: 6 }, desc: '-6% repair cost / rank.' },
        { id: 'engineering-mastery', name: 'Engineering Mastery', icon: '👑', max: 2, req: 8, stats: { shield: 3, regen: 4 }, desc: '+3% shield, +4% regen / rank.' },
        { id: 'aegis-protocol', name: 'Aegis Protocol', icon: '🏛', max: 2, req: 9, stats: { shield: 4 }, desc: '+4% max shield / rank.' }
      ] },
    { id: 'trading', name: 'Trading', icon: '💰', desc: 'Better prices, bigger holds.',
      nodes: [
        { id: 'haggle', name: 'Haggle', icon: '🤝', max: 3, req: 0, stats: { buyDisc: 3 }, desc: '-3% buy prices / rank.' },
        { id: 'market-sense', name: 'Market Sense', icon: '📈', max: 3, req: 0, stats: { sellBonus: 3 }, desc: '+3% sell prices / rank.' },
        { id: 'cargo-nets', name: 'Cargo Nets', icon: '🕸', max: 2, req: 2, stats: { cargo: 4 }, desc: '+4t cargo hold / rank.' },
        { id: 'bulk-deals', name: 'Bulk Deals', icon: '📦', max: 3, req: 3, stats: { buyDisc: 3 }, desc: '-3% buy prices / rank.' },
        { id: 'broker', name: 'Broker License', icon: '📜', max: 3, req: 4, stats: { sellBonus: 3 }, desc: '+3% sell prices / rank.' },
        { id: 'hold-expansion', name: 'Hold Expansion', icon: '🏗', max: 2, req: 6, stats: { cargo: 6 }, desc: '+6t cargo hold / rank.' },
        { id: 'insider', name: 'Insider Contacts', icon: '🕵', max: 2, req: 6, stats: { buyDisc: 2, sellBonus: 2 }, desc: '-2% buy, +2% sell / rank.' },
        { id: 'manifest', name: 'Tight Manifest', icon: '🗂', max: 2, req: 7, stats: { cargo: 4 }, desc: '+4t cargo hold / rank.' },
        { id: 'trade-mastery', name: 'Trade Mastery', icon: '👑', max: 2, req: 8, stats: { buyDisc: 2, sellBonus: 2, cargo: 2 }, desc: '-2% buy, +2% sell, +2t cargo / rank.' },
        { id: 'arbitrage', name: 'Arbitrage', icon: '🔁', max: 2, req: 9, stats: { sellBonus: 4 }, desc: '+4% sell prices / rank.' }
      ] },
    { id: 'leadership', name: 'Leadership', icon: '⭐', desc: 'Wingmen, crew, hire costs.',
      nodes: [
        { id: 'wing-tactics', name: 'Wing Tactics', icon: '✈', max: 3, req: 0, stats: { wingman: 8 }, desc: '+8% wingman damage / rank.' },
        { id: 'inspire', name: 'Inspire', icon: '📣', max: 3, req: 0, stats: { crew: 6 }, desc: '+6% crew effectiveness / rank.' },
        { id: 'hire-charm', name: 'Silver Tongue', icon: '🗣', max: 2, req: 2, stats: { hireDisc: 10 }, desc: '-10% companion hire cost / rank.' },
        { id: 'command-presence', name: 'Command Presence', icon: '🎖', max: 3, req: 3, stats: { wingman: 8 }, desc: '+8% wingman damage / rank.' },
        { id: 'rally', name: 'Rally the Crew', icon: '🥁', max: 3, req: 4, stats: { crew: 6 }, desc: '+6% crew effectiveness / rank.' },
        { id: 'ace-tactics', name: 'Ace Tactics', icon: '🏆', max: 2, req: 6, stats: { wingman: 10 }, desc: '+10% wingman damage / rank.' },
        { id: 'veteran-crew', name: 'Veteran Crew', icon: '🧓', max: 2, req: 6, stats: { crew: 8 }, desc: '+8% crew effectiveness / rank.' },
        { id: 'negotiator', name: 'Negotiator', icon: '⚖', max: 2, req: 7, stats: { hireDisc: 8 }, desc: '-8% companion hire cost / rank.' },
        { id: 'leadership-mastery', name: 'Leadership Mastery', icon: '👑', max: 2, req: 8, stats: { wingman: 4, crew: 4 }, desc: '+4% wingman dmg, +4% crew / rank.' },
        { id: 'legend-command', name: 'Legendary Command', icon: '🌟', max: 2, req: 9, stats: { wingman: 5, crew: 5 }, desc: '+5% wingman dmg, +5% crew / rank.' }
      ] }
  ];

  var NODE_BY_ID = {};
  var TREE_BY_ID = {};
  TREES.forEach(function (t) {
    TREE_BY_ID[t.id] = t;
    t.nodes.forEach(function (n) { n.tree = t.id; NODE_BY_ID[n.id] = n; });
  });

  /* ---------------- prestige (skill-prestige phase, additive) ----------------
   * A fully-maxed tree can be prestiged: the tree's spent ranks reset to 0
   * (no refund), and the tree gains a permanent stacking +4% bonus to its
   * effect, applied multiplicatively to that tree's contribution in each
   * formula hook. Capped at 5 prestiges per tree (max +20% on the tree).
   * State rides the skills blob (additive key, defensive reads) — save-neutral,
   * no SAVE_VERSION bump.
   */
  var PRESTIGE_MAX = 5;
  var PRESTIGE_BONUS_PCT = 4; // +4% per prestige

  /* ---------------- state ---------------- */

  function def() {
    return { xp: 0, level: 1, points: 0, ranks: {}, prestige: {} };
  }

  function sanitize(d) {
    var s = def();
    if (d && typeof d === 'object') {
      s.xp = Math.max(0, d.xp | 0);
      s.level = Math.max(1, d.level | 0);
      s.points = Math.max(0, d.points | 0);
      if (d.ranks && typeof d.ranks === 'object') {
        Object.keys(d.ranks).forEach(function (k) {
          if (NODE_BY_ID[k]) s.ranks[k] = clamp(d.ranks[k] | 0, 0, NODE_BY_ID[k].max);
        });
      }
      if (d.basis && typeof d.basis === 'object') s.basis = d.basis; // trade cost basis
      // prestige: additive key, defensive reads (missing/invalid -> 0, capped at 5)
      if (d.prestige && typeof d.prestige === 'object') {
        TREES.forEach(function (t) {
          var c = d.prestige[t.id] | 0;
          if (c > 0) s.prestige[t.id] = clamp(c, 0, PRESTIGE_MAX);
        });
      }
    }
    return s;
  }

  function st() {
    var p = SF.Player;
    if (!p.skillState) p.skillState = def();
    return p.skillState;
  }

  /* XP to go from level L to L+1 (L >= 1). */
  function xpNeed(L) { return Math.floor(120 * Math.pow(L, 1.35)); }

  var xpToastAcc = 0, xpToastAt = 0;

  function floatToast() {
    var now = Date.now();
    if (xpToastAcc > 0 && now - xpToastAt > 1600 && SF.HUD && SF.HUD.toast) {
      SF.HUD.toast('+' + xpToastAcc + ' XP');
      xpToastAcc = 0;
      xpToastAt = now;
    }
  }

  /* ---------------- public API ---------------- */

  var Skills = {
    TREES: TREES,
    TREE_BY_ID: TREE_BY_ID,
    NODE_BY_ID: NODE_BY_ID,
    skillDefault: def,
    sanitize: sanitize,
    xpNeed: xpNeed,

    state: function () { return st(); },
    level: function () { return st().level; },
    xp: function () { return st().xp; },
    points: function () { return st().points; },
    ranks: function (nodeId) { return st().ranks[nodeId] || 0; },

    xpIntoLevel: function () {
      var s = st(), need = xpNeed(s.level);
      return { have: s.xp, need: need };
    },

    treePoints: function (treeId) {
      var s = st(), t = TREE_BY_ID[treeId], total = 0;
      if (!t) return 0;
      t.nodes.forEach(function (n) { total += s.ranks[n.id] || 0; });
      return total;
    },

    /* total rank capacity of a tree (sum of node maxes) */
    treeMax: function (treeId) {
      var t = TREE_BY_ID[treeId], total = 0;
      if (!t) return 0;
      t.nodes.forEach(function (n) { total += n.max; });
      return total;
    },

    isTreeMaxed: function (treeId) {
      return this.treePoints(treeId) >= this.treeMax(treeId) && this.treeMax(treeId) > 0;
    },

    /* ---------------- prestige ---------------- */

    prestigeCount: function (treeId) {
      var c = st().prestige[treeId] | 0;
      return clamp(c, 0, PRESTIGE_MAX);
    },

    /* stacking prestige multiplier for one tree: 1 + 4% per prestige */
    prestigeMul: function (treeId) {
      return 1 + (this.prestigeCount(treeId) * PRESTIGE_BONUS_PCT) / 100;
    },

    canPrestige: function (treeId) {
      return this.isTreeMaxed(treeId) && this.prestigeCount(treeId) < PRESTIGE_MAX;
    },

    /* Prestige a maxed tree: reset its spent ranks to 0 (NO refund) and
     * increment the permanent prestige counter. Returns true on success. */
    prestige: function (treeId) {
      if (!this.canPrestige(treeId)) return false;
      var s = st(), t = TREE_BY_ID[treeId];
      t.nodes.forEach(function (n) { delete s.ranks[n.id]; });
      s.prestige[treeId] = this.prestigeCount(treeId) + 1;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('⭐ ' + t.name + ' PRESTIGED — +' + (this.prestigeCount(treeId) * PRESTIGE_BONUS_PCT) + '% permanent bonus!');
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      /* voice-wiring-v6: pack-6 prestige line per tree, guarded, save-neutral */
      if (window.SF && SF.Voice6 && SF.Voice6.say) { try { SF.Voice6.say('prestige_' + treeId + '_01'); } catch (e) {} }
      if (SF.Save) SF.Save.save();
      return true;
    },

    canSpend: function (nodeId) {
      var n = NODE_BY_ID[nodeId];
      if (!n) return false;
      var s = st();
      if (s.points <= 0) return false;
      if ((s.ranks[nodeId] || 0) >= n.max) return false;
      if (this.treePoints(n.tree) < n.req) return false;
      return true;
    },

    spend: function (nodeId) {
      if (!this.canSpend(nodeId)) return false;
      var s = st();
      s.ranks[nodeId] = (s.ranks[nodeId] || 0) + 1;
      s.points--;
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      if (SF.Save) SF.Save.save();
      return true;
    },

    refundAll: function () {
      // full respec: returns every spent point (cheap, keeps loop simple)
      var s = st(), total = 0;
      Object.keys(s.ranks).forEach(function (k) { total += s.ranks[k]; });
      s.ranks = {};
      s.points += total;
      if (SF.Save) SF.Save.save();
    },

    /* sum of per-rank stat values across all trees */
    bonus: function (stat) {
      var s = st(), total = 0;
      Object.keys(s.ranks).forEach(function (id) {
        var n = NODE_BY_ID[id];
        if (n && n.stats[stat]) total += n.stats[stat] * s.ranks[id];
      });
      return total;
    },

    /* sum of per-rank stat values for ONE tree (prestige-aware hooks use this) */
    treeBonus: function (treeId, stat) {
      var s = st(), t = TREE_BY_ID[treeId], total = 0;
      if (!t) return 0;
      t.nodes.forEach(function (n) {
        if (n.stats[stat]) total += n.stats[stat] * (s.ranks[n.id] || 0);
      });
      return total;
    },

    /* prestige-scaled contribution of one tree to a percent-multiplier stat */
    effPct: function (treeId, stat) {
      return (this.treeBonus(treeId, stat) * this.prestigeMul(treeId)) / 100;
    },

    /* prestige-scaled contribution of one tree to a flat stat (e.g. cargo) */
    effFlat: function (treeId, stat) {
      return this.treeBonus(treeId, stat) * this.prestigeMul(treeId);
    },

    /* ---- formula hooks ----
     * WIRED (see header): dmgMul/rateMul/rangeMul (via SF.Mods),
     *   shieldMul/regenMul/speedMul/handlingMul/accelMul (inside
     *   ship.js's own seams — skills.js must NOT also wrap the
     *   SF.Player.maxShield facade, which delegates to ship.js's
     *   private maxShield and would double-apply),
     *   sellMul/buyMul (via SF.Trading.price), cargoBonus (via
     *   SF.Player.cargoSpace), crewMul (via SF.Crew.power),
     *   repairCostMul (station.js repair prices), hireCostMul
     *   (SF.Companions.effCost), wingmanMul (quests.js fire line).
     *
     * skill-prestige: each hook now applies its tree's prestige multiplier
     * to that tree's contribution. With 0 prestiges prestigeMul = 1, so
     * values are identical to the pre-prestige behavior.
     */
    dmgMul: function () { return 1 + this.effPct('gunnery', 'damage'); },
    rateMul: function () { return 1 + this.effPct('gunnery', 'fireRate'); },
    rangeMul: function () { return 1 + this.effPct('gunnery', 'range'); },
    speedMul: function () { return 1 + this.effPct('piloting', 'speed'); },
    handlingMul: function () { return 1 + this.effPct('piloting', 'handling'); },
    accelMul: function () { return 1 + this.effPct('piloting', 'accel'); },
    shieldMul: function () { return 1 + this.effPct('engineering', 'shield'); },
    regenMul: function () { return 1 + this.effPct('engineering', 'regen'); },
    crewMul: function () { return 1 + this.effPct('leadership', 'crew'); },
    wingmanMul: function () { return 1 + this.effPct('leadership', 'wingman'); },
    sellMul: function () { return 1 + this.effPct('trading', 'sellBonus'); },
    cargoBonus: function () { return this.effFlat('trading', 'cargo'); },
    buyMul: function () { return discMul(this.effFlat('trading', 'buyDisc')); },
    repairCostMul: function () { return discMul(this.effFlat('engineering', 'repairDisc')); },
    hireCostMul: function () { return discMul(this.effFlat('leadership', 'hireDisc')); },

    /* ---- XP events ---- */
    addXP: function (n, why) {
      if (!n || n <= 0) return;
      /* shop-launch: +50% while a Dark Matter XP boost is running */
      if (window.SF && SF.Shop && SF.Shop.xpBoostActive && SF.Shop.xpBoostActive()) {
        n = Math.round(n * 1.5);
      }
      var s = st();
      s.xp += n;
      xpToastAcc += n;
      var leveled = false;
      while (s.xp >= xpNeed(s.level)) {
        s.xp -= xpNeed(s.level);
        s.level++;
        s.points += 2; // 2 skill points per level
        leveled = true;
      }
      if (leveled) {
        xpToastAcc = 0;
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('⬆ LEVEL ' + s.level + '! +2 skill points — open 🎓 SKILLS [K]');
        /* twelve-hour-wave2: distinct level-up cue (was the credit blip). */
        if (SF.Audio && SF.Audio.levelUp) SF.Audio.levelUp();
        else if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
        if (SF.Save) SF.Save.save();
      }
      floatToast();
    },

    onKill: function (e) {
      var xp = 15;
      if (e) {
        if (e.faction) xp = 30;
        else if (e.type === 'drone') xp = 12;
        else if (e.type === 'raider') xp = 25;
        else if (e.type === 'gunship') xp = 60;
      }
      this.addXP(xp, 'kill');
    },

    /* Mining XP — call site: pickups.js ore collection (asteroids break
     * into ore pickups). 1 XP per ore, the rate this API always shipped. */
    onOre: function (n) { this.addXP(Math.max(1, Math.floor(n || 0)), 'mine'); },

    onTradeProfit: function (profit) {
      var xp = Math.floor((profit || 0) / 10);
      if (xp > 0) this.addXP(xp, 'trade');
    },

    onQuest: function (diff) {
      this.addXP(80 + 60 * (diff || 0), 'quest');
    },

    onMission: function () { this.addXP(60, 'mission'); },

    /* ---- persistence hooks (ship.js untouched) ---- */
    _reset: function () { SF.Player.skillState = def(); },
    _restore: function (d) { SF.Player.skillState = sanitize(d); },

    /* ---- module hooks (wraps, campaign.js-style) ---- */
    install: function () {
      var self = this;
      function wrap(obj, name, fn) {
        if (!obj || !obj[name] || obj[name].__skills) return false;
        var orig = obj[name];
        var w = function () { return fn.call(this, orig, arguments); };
        w.__skills = true;
        obj[name] = w;
        return true;
      }

      // kills -> XP (chains under campaign.js, which wraps onKill later)
      wrap(SF.Quests, 'onKill', function (orig, args) {
        try { orig.apply(this, args); } finally { self.onKill(args[0]); }
      });

      // quest turn-ins -> XP (diff captured before the original consumes state)
      wrap(SF.Quests, 'turnIn', function (orig, args) {
        var qd = questDiff(args[0]);
        var ok = orig.apply(this, args);
        if (ok) self.onQuest(qd);
        return ok;
      });

      if (SF.Trading) {
        // trading: track cost basis, award XP on profitable sales
        wrap(SF.Trading, 'buy', function (orig, args) {
          var st = args[0], goodId = args[1], n = args[2] || 1;
          var cost = SF.Trading.price(st, goodId, 'buy') * n;
          var ok = orig.apply(this, args);
          if (ok) {
            var b = self._basis(goodId);
            b.spent += cost; b.qty += n;
          }
          return ok;
        });
        wrap(SF.Trading, 'sell', function (orig, args) {
          var st = args[0], goodId = args[1], n = args[2] || 1;
          var revenue = SF.Trading.price(st, goodId, 'sell') * n;
          var b = self._basis(goodId);
          var avg = b.qty > 0 ? b.spent / b.qty : 0;
          var ok = orig.apply(this, args);
          if (ok) {
            var profit = revenue - avg * n;
            b.spent = Math.max(0, b.spent - avg * n);
            b.qty = Math.max(0, b.qty - n);
            if (profit > 0) self.onTradeProfit(profit);
          }
          return ok;
        });
        // price skill bonuses (haggle / market-sense), stacked on faction cuts
        wrap(SF.Trading, 'price', function (orig, args) {
          var p = orig.apply(this, args);
          if (args[2] === 'buy') return Math.max(1, Math.ceil(p * self.buyMul()));
          return Math.max(1, Math.floor(p * self.sellMul()));
        });
      }

      // Gunnery: the SF.Mods multipliers are the single seam read by
      // ship.js fire() and by the mods DPS preview UI — one wrap each
      // applies skill damage/rate/range everywhere consistently.
      if (SF.Mods) {
        wrap(SF.Mods, 'damageMul', function (orig, args) {
          return orig.apply(this, args) * self.dmgMul();
        });
        wrap(SF.Mods, 'rateMul', function (orig, args) {
          return orig.apply(this, args) * self.rateMul();
        });
        wrap(SF.Mods, 'rangeMul', function (orig, args) {
          return orig.apply(this, args) * self.rangeMul();
        });
      }

      // Engineering shield + Trading cargo: public SF.Player accessors.
      // NOTE (twelve-hour-wave3): NO SF.Player.maxShield wrap here on
      // purpose — ship.js's private maxShield() now applies shieldMul
      // itself, and the facade delegates to it. Wrapping the facade too
      // would square the bonus (verified by the wave3 double-apply check).
      if (SF.Player) {
        wrap(SF.Player, 'cargoSpace', function (orig, args) {
          return orig.apply(this, args) + self.cargoBonus();
        });
        // persistence: stash the skills blob on the serialized player object
        wrap(SF.Player, 'serialize', function (orig, args) {
          var d = orig.apply(this, args);
          d.skills = JSON.parse(JSON.stringify(st()));
          return d;
        });
        wrap(SF.Player, 'deserialize', function (orig, args) {
          orig.apply(this, args); // calls wrapped create() -> _reset()
          self._restore(args[0] && args[0].skills);
        });
        wrap(SF.Player, 'create', function (orig, args) {
          orig.apply(this, args);
          self._reset();
        });
      }

      // Leadership crew effectiveness (boarding power)
      if (SF.Crew) {
        wrap(SF.Crew, 'power', function (orig, args) {
          return orig.apply(this, args) * self.crewMul();
        });
      }

      // close the skills overlay whenever the game state changes
      // (setState's showOnly list doesn't know overlay-skills)
      if (SF.Game) {
        wrap(SF.Game, 'setState', function (orig, args) {
          self.closeUI();
          return orig.apply(this, args);
        });
      }
    },

    _basis: function (goodId) {
      var s = st();
      s.basis = s.basis || {};
      if (!s.basis[goodId]) s.basis[goodId] = { spent: 0, qty: 0 };
      return s.basis[goodId];
    },

    /* ---- UI ---- */
    openUI: function () {
      ensureOverlay();
      this._tab = this._tab || 'gunnery';
      this.render();
      SF.Game.showOverlay('overlay-skills');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    },
    closeUI: function () {
      var o = document.getElementById('overlay-skills');
      if (o) o.classList.add('hidden');
    },

    render: function () {
      var body = document.getElementById('skills-body');
      if (!body) return;
      body.innerHTML = '';
      var s = st();
      var self = this;

      var head = document.createElement('div');
      head.className = 'skills-head';
      var il = this.xpIntoLevel();
      head.innerHTML =
        '<div class="skills-title">🎓 SKILLS <span class="dim">— Level ' + s.level + '</span></div>' +
        '<div class="xpbar"><div class="xpbar-fill" style="width:' +
        Math.min(100, Math.round(100 * il.have / il.need)) + '%"></div></div>' +
        '<div class="skills-sub">' + il.have + ' / ' + il.need + ' XP &nbsp;·&nbsp; ' +
        '<b style="color:#ffd23f">' + s.points + ' skill points</b>' +
        ' <button id="skills-respec" class="btn small">RESPEC</button></div>';
      body.appendChild(head);
      head.querySelector('#skills-respec').addEventListener('click', function () {
        self.refundAll(); self.render();
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Skills refunded.');
      });

      var tabs = document.createElement('div');
      tabs.className = 'skills-tabs';
      TREES.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'btn small skills-tab' + (self._tab === t.id ? ' active' : '');
        var pc = self.prestigeCount(t.id);
        b.textContent = t.icon + ' ' + t.name + ' (' + self.treePoints(t.id) + ')' +
          (pc > 0 ? ' ★×' + pc : '');
        b.addEventListener('click', function () { self._tab = t.id; self.render(); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);

      var t = TREE_BY_ID[this._tab];
      var tdesc = document.createElement('div');
      tdesc.className = 'dim skills-tdesc';
      tdesc.textContent = t.icon + ' ' + t.desc + ' — ' + this.treePoints(t.id) + ' points in tree.';
      body.appendChild(tdesc);

      // prestige panel: badge + prestige button when the tree is maxed
      var pc = this.prestigeCount(t.id);
      var pdiv = document.createElement('div');
      pdiv.className = 'skills-prestige';
      var badge = pc > 0 ? ' <span class="prestige-stars">' + stars(pc) + '</span>' : '';
      var phtml = '<span class="prestige-label">⭐ PRESTIGE' + badge + '</span> ' +
        '<span class="dim">— +' + (pc * PRESTIGE_BONUS_PCT) + '% permanent tree bonus (' +
        pc + '/' + PRESTIGE_MAX + ')</span>';
      if (this.canPrestige(t.id)) {
        phtml += ' <button id="skills-prestige-btn" class="btn small prestige-btn">⭐ PRESTIGE — reset tree, +' +
          PRESTIGE_BONUS_PCT + '% forever</button>';
      } else if (!this.isTreeMaxed(t.id)) {
        phtml += ' <span class="dim">— max every node to prestige (resets ranks, keeps nothing)</span>';
      }
      pdiv.innerHTML = phtml;
      body.appendChild(pdiv);
      var pbtn = pdiv.querySelector('#skills-prestige-btn');
      if (pbtn) pbtn.addEventListener('click', function () {
        if (self.prestige(t.id)) self.render();
      });

      var grid = document.createElement('div');
      grid.className = 'skills-grid';
      t.nodes.forEach(function (n) {
        var ranks = self.ranks(n.id);
        var locked = self.treePoints(t.id) < n.req;
        var maxed = ranks >= n.max;
        var can = !locked && !maxed && s.points > 0;
        var d = document.createElement('div');
        d.className = 'skill-node' + (locked ? ' locked' : '') + (maxed ? ' maxed' : '');
        var pips = '';
        for (var i = 0; i < n.max; i++) pips += i < ranks ? '●' : '○';
        d.innerHTML =
          '<div class="skill-name">' + n.icon + ' ' + n.name + '</div>' +
          '<div class="skill-pips">' + pips + '</div>' +
          '<div class="skill-desc">' + n.desc +
          (locked ? '<br><span class="skill-lock">🔒 needs ' + n.req + ' pts in ' + t.name + '</span>' : '') +
          '</div>' +
          '<button class="btn small skill-spend"' + (can ? '' : ' disabled') + '>' +
          (maxed ? 'MAX' : locked ? 'LOCKED' : s.points > 0 ? '+ SPEND' : 'NO PTS') + '</button>';
        d.querySelector('button').addEventListener('click', function () {
          if (self.spend(n.id)) self.render();
        });
        grid.appendChild(d);
      });
      body.appendChild(grid);
    }
  };

  function questDiff(questId) {
    var arr = (SF.Player.questState && SF.Player.questState.active) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === questId) return arr[i].diff || 0;
    return 0;
  }

  function stars(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '★';
    return s;
  }

  /* Additive interpretation of discount percents (conservative: a full
   * Trading tree = 26% off buys). Floor at 75% of list price. */
  function discMul(totalPct) {
    return Math.max(0.25, 1 - totalPct / 100);
  }

  /* ---- runtime DOM: overlay + styles (index.html/css are outside this
   * phase's file scope, so the skills UI builds its own DOM + CSS) ---- */
  var SKILLS_CSS = [
    '.skills-head{margin-bottom:10px}',
    '.skills-title{font-size:20px;font-weight:bold;color:#fff;margin-bottom:6px}',
    '.xpbar{height:10px;background:#101828;border:1px solid #2a3a5f;border-radius:5px;overflow:hidden}',
    '.xpbar-fill{height:100%;background:linear-gradient(90deg,#39d5e8,#7c5cff);transition:width .3s}',
    '.skills-sub{margin-top:6px;color:#9fb3d9;font-size:13px}',
    '.skills-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}',
    '.skills-tab.active{border-color:#ffd23f;color:#ffd23f}',
    '.skills-tdesc{margin-bottom:8px;font-size:13px}',
    '.skills-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:46vh;overflow-y:auto}',
    '.skill-node{border:1px solid #2a3a5f;border-radius:8px;padding:8px;background:rgba(10,16,32,.6)}',
    '.skill-node.locked{opacity:.55}',
    '.skill-node.maxed{border-color:#ffd23f}',
    '.skill-name{font-weight:bold;color:#fff;font-size:13px}',
    '.skill-pips{color:#ffd23f;letter-spacing:2px;font-size:12px;margin:2px 0}',
    '.skill-desc{font-size:12px;color:#9fb3d9;line-height:1.35}',
    '.skill-lock{color:#ff5e3a}',
    '.skill-node .skill-spend{margin-top:6px;width:100%}',
    '#overlay-skills .panel{max-width:600px}',
    '.skills-prestige{margin:0 0 10px;padding:8px 10px;border:1px dashed #6a5cff;border-radius:8px;background:rgba(30,20,70,.35);font-size:13px}',
    '.prestige-label{color:#ffd23f;font-weight:bold}',
    '.prestige-stars{color:#ffd23f;letter-spacing:2px}',
    '.prestige-btn{margin-left:8px;border-color:#ffd23f;color:#ffd23f}'
  ].join('\n');

  function ensureOverlay() {
    if (!document.getElementById('skills-css')) {
      var stEl = document.createElement('style');
      stEl.id = 'skills-css';
      stEl.textContent = SKILLS_CSS;
      document.head.appendChild(stEl);
    }
    if (document.getElementById('overlay-skills')) return;
    var o = document.createElement('div');
    o.id = 'overlay-skills';
    o.className = 'overlay hidden';
    o.innerHTML = '<div class="panel wide"><div id="skills-body"></div>' +
      '<button id="btn-skills-close" class="btn big ui-block">CLOSE [K]</button></div>';
    document.body.appendChild(o);
    document.getElementById('btn-skills-close').addEventListener('click', function () {
      Skills.closeUI();
      if (SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack();
    });
  }

  /* Migrate a v10 player blob to v11: skills XP/levels/points blob.
   * Defined here (not ship.js) — skills-system-retry's file scope covers
   * js/skills.js + js/save.js but not js/ship.js. save.js calls it by name
   * at load time, long after this file has executed. */
  SF.Player.migrateV10 = function (d) {
    d.skills = sanitize(d.skills);
    return d;
  };

  SF.Skills = Skills;
  ensureOverlay();
  Skills.install();
})();

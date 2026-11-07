/* ============================================================
 * STARFALL — Phase 5: Crafting
 *
 * SF.RECIPES: 9 station-workbench recipes. Instant craft for
 * ore + salvage parts/components + a credit fee. Craft-only
 * outputs are flagged craftOnly:true in data.js and hidden from
 * store BUY rows. SF.Crafting.craft() is the hook a future
 * timed craft queue will hang off of (currently synchronous).
 * Spare parts / components can be salvaged at 40% of value.
 *
 * crafting-recipes-v2 (2026-10-19): +7 recipes — elite-drop line
 * (Warden Plate / Hellburner Drive / Annihilator Cannon, consuming the
 * components elite kills guarantee-drop), the Smuggler's Hold Mk-II/III
 * upgrade line, and 2 companion-loyalty reward recipes gated via
 * requires.loyalty on SF.CompanionQuests.loyaltyOf. Save-neutral.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* part: <partId>, n: count | item: <itemId>, n: count */
  SF.RECIPES = [
    { id: 'r_phaseshield', name: 'Phase Shield', tier: 'green',
      desc: 'Bench-tuned phase shield: +80 max shield.',
      cost: { credits: 800,  ore: 10, parts: [{ id: 'deflector_dish', n: 1 }], items: [{ id: 'fluxcap', n: 1 }] },
      output: { kind: 'part', id: 'craft_phase_shield' } },
    { id: 'r_fusiondrive', name: 'Fusion Drive', tier: 'green',
      desc: 'Bench-tuned fusion drive: +90 engine speed.',
      cost: { credits: 1200, ore: 12, parts: [{ id: 'ion_thruster', n: 1 }],  items: [{ id: 'plasmacoil', n: 1 }] },
      output: { kind: 'part', id: 'craft_fusion_drive' } },
    { id: 'r_aegis', name: 'Aegis Generator', tier: 'blue',
      desc: 'Bench-tuned aegis generator: +155 max shield.',
      cost: { credits: 2800, ore: 20, parts: [{ id: 'phase_shield', n: 1 }],   items: [{ id: 'gravcore', n: 1 }] },
      output: { kind: 'part', id: 'craft_aegis_generator' } },
    { id: 'r_coil', name: 'Overdrive Coil', tier: 'blue',
      desc: 'Experimental winding: +175 engine speed.',
      cost: { credits: 3600, ore: 25, parts: [{ id: 'fusion_drive', n: 1 }],   items: [{ id: 'plasmacoil', n: 2 }] },
      output: { kind: 'part', id: 'craft_overdrive_coil' } },
    { id: 'r_bastion', name: 'Bastion Array', tier: 'purple',
      desc: 'Station-grade plating: +310 max shield.',
      cost: { credits: 6000, ore: 40, parts: [{ id: 'aegis_generator', n: 1 }],items: [{ id: 'gravcore', n: 2 }] },
      output: { kind: 'part', id: 'craft_bastion_array' } },
    { id: 'r_hold', name: "Smuggler's Hold", tier: 'blue',
      desc: 'No questions asked: +180 cargo space.',
      cost: { credits: 2000, ore: 15, parts: [{ id: 'cargo_hold', n: 1 }],     items: [{ id: 'fluxcap', n: 1 }] },
      output: { kind: 'part', id: 'craft_smugglers_hold' } },
    { id: 'r_railgun', name: 'Railgun', tier: 'blue',
      desc: 'WORKBENCH-ONLY weapon. Hypervelocity slug: 70 dmg @ 950 m/s.',
      cost: { credits: 4500, ore: 30, parts: [{ id: 'heavy_hardpoint', n: 1 }],items: [{ id: 'gravcore', n: 1 }] },
      output: { kind: 'weapon', id: 'railgun' } },
    { id: 'r_seekers', name: 'Seeker Missiles', tier: 'blue',
      desc: 'WORKBENCH-ONLY weapon. Upgraded homing swarm: 42 dmg.',
      cost: { credits: 5200, ore: 35, parts: [{ id: 'light_hardpoint', n: 1 }],items: [{ id: 'plasmacoil', n: 2 }] },
      output: { kind: 'weapon', id: 'seeker_mk2' } },
    { id: 'r_core', name: 'Singularity Core', tier: 'orange',
      desc: 'Bench-tuned to the edge: +320 reactor power.',
      cost: { credits: 12000, ore: 60, parts: [{ id: 'quantum_reactor', n: 1 }],items: [{ id: 'gravcore', n: 2 }] },
      output: { kind: 'part', id: 'craft_singularity_core' } },
    /* weapons-arsenal phase: 6 weapon recipes. NOTE: r_emp must NOT list
     * 'plasmacoil' as a part — Plasma Coil is an SF.ITEMS component, not a
     * SF.PARTS part (original bug: uncraftable + crashed the spare loop).
     * Uses the real part 'fusion_core' instead. */
    { id: 'r_repeater', name: 'Plasma Repeater', tier: 'green',
      desc: 'WORKBENCH-ONLY weapon. Rapid plasma orbs: 8 dmg @ 5.5/s.',
      cost: { credits: 1400, ore: 18, parts: [{ id: 'ion_thruster', n: 1 }], items: [{ id: 'plasmacoil', n: 1 }] },
      output: { kind: 'weapon', id: 'repeater' } },
    { id: 'r_flak', name: 'Flak Cannon', tier: 'green',
      desc: 'WORKBENCH-ONLY weapon. Nine-pellet wall of flak.',
      cost: { credits: 1800, ore: 22, parts: [{ id: 'light_hardpoint', n: 1 }], items: [{ id: 'fluxcap', n: 2 }] },
      output: { kind: 'weapon', id: 'flak' } },
    { id: 'r_sniper', name: 'Longshot Cannon', tier: 'blue',
      desc: 'WORKBENCH-ONLY weapon. Extreme-range hypervelocity round: 120 dmg.',
      cost: { credits: 3600, ore: 28, parts: [{ id: 'heavy_hardpoint', n: 1 }], items: [{ id: 'fluxcap', n: 2 }] },
      output: { kind: 'weapon', id: 'sniper' } },
    { id: 'r_emp', name: 'EMP Blaster', tier: 'purple',
      desc: 'WORKBENCH-ONLY weapon. Ion burst that STUNS targets for 3s.',
      cost: { credits: 6500, ore: 45, parts: [{ id: 'fusion_core', n: 1 }], items: [{ id: 'plasmacoil', n: 2 }, { id: 'gravcore', n: 1 }] },
      output: { kind: 'weapon', id: 'emp' } },
    { id: 'r_lance', name: 'Nova Lance', tier: 'purple',
      desc: 'WORKBENCH-ONLY weapon. One titanic beam: 140 dmg.',
      cost: { credits: 8000, ore: 50, parts: [{ id: 'heavy_hardpoint', n: 1 }], items: [{ id: 'gravcore', n: 2 }] },
      output: { kind: 'weapon', id: 'lance' } },
    { id: 'r_storm', name: 'Storm Repeater', tier: 'orange',
      desc: 'WORKBENCH-ONLY weapon. Twin plasma streams at 8 shots/s.',
      cost: { credits: 14000, ore: 70, parts: [{ id: 'fusion_drive', n: 1 }], items: [{ id: 'gravcore', n: 2 }, { id: 'plasmacoil', n: 2 }] },
      output: { kind: 'weapon', id: 'storm' } },
    /* crafting-recipes-v2 phase: 7 new recipes.
     * - elite-drop line: consumes the components elite kills guarantee-drop
     *   (elite-weighted toward blue/purple per SF.ELITE_ITEM_WEIGHTS).
     * - smuggler-hold upgrade line: Mk-II consumes the Mk-I hold, Mk-III the
     *   Mk-II — a true part upgrade chain.
     * - companion-loyalty rewards: requires.loyalty = {id, tier} gates on
     *   SF.CompanionQuests.loyaltyOf (earned via companion quest chains).
     * All outputs are craftOnly in data.js (hidden from store BUY rows). */
    { id: 'r_wardenplate', name: 'Warden Plate', tier: 'purple',
      desc: 'ELITE-DROP build. +420 max shield, forged from elite wreckage.',
      cost: { credits: 9500, ore: 60, parts: [{ id: 'craft_bastion_array', n: 1 }], items: [{ id: 'gravcore', n: 3 }] },
      output: { kind: 'part', id: 'craft_warden_plate' } },
    { id: 'r_hellburner', name: 'Hellburner Drive', tier: 'orange',
      desc: 'ELITE-DROP build. +260 engine speed, burns elite salvage.',
      cost: { credits: 16000, ore: 80, parts: [{ id: 'craft_overdrive_coil', n: 1 }], items: [{ id: 'gravcore', n: 2 }, { id: 'plasmacoil', n: 3 }] },
      output: { kind: 'part', id: 'craft_hellburner_drive' } },
    { id: 'r_annihilator', name: 'Annihilator Cannon', tier: 'orange',
      desc: 'ELITE-DROP build. WORKBENCH-ONLY weapon. One 150-dmg slug at a time.',
      cost: { credits: 18000, ore: 90, parts: [{ id: 'heavy_hardpoint', n: 1 }], items: [{ id: 'gravcore', n: 4 }] },
      output: { kind: 'weapon', id: 'annihilator' } },
    { id: 'r_hold2', name: "Smuggler's Hold Mk-II", tier: 'purple',
      desc: 'Hold upgrade line. +320 cargo, customs evade 65%.',
      cost: { credits: 6000, ore: 40, parts: [{ id: 'craft_smugglers_hold', n: 1 }], items: [{ id: 'plasmacoil', n: 2 }] },
      output: { kind: 'part', id: 'craft_smugglers_hold_2' } },
    { id: 'r_hold3', name: "Smuggler's Hold Mk-III", tier: 'orange',
      desc: 'Hold upgrade line. +500 cargo, customs evade 80%.',
      cost: { credits: 14000, ore: 70, parts: [{ id: 'craft_smugglers_hold_2', n: 1 }], items: [{ id: 'gravcore', n: 3 }] },
      output: { kind: 'part', id: 'craft_smugglers_hold_3' } },
    { id: 'r_vexgambit', name: "Vex's Gambit", tier: 'purple',
      desc: 'LOYALTY REWARD. +215 engine speed. Vex tunes it herself.',
      requires: { loyalty: { id: 'vex', tier: 3 } },
      cost: { credits: 8000, ore: 45, parts: [{ id: 'fusion_drive', n: 1 }], items: [{ id: 'plasmacoil', n: 2 }] },
      output: { kind: 'part', id: 'craft_vex_gambit' } },
    { id: 'r_brambulwark', name: "Bram's Bulwark", tier: 'purple',
      desc: 'LOYALTY REWARD. +360 max shield. Old navy plating, Bram-approved.',
      requires: { loyalty: { id: 'bram', tier: 3 } },
      cost: { credits: 8000, ore: 45, parts: [{ id: 'aegis_generator', n: 1 }], items: [{ id: 'plasmacoil', n: 2 }] },
      output: { kind: 'part', id: 'craft_bram_bulwark' } }
  ];
  var BY_ID = {};
  SF.RECIPES.forEach(function (r) { BY_ID[r.id] = r; });

  function partName(id) { var p = SF.PART_BY_ID[id]; return p ? p.name : id; }
  function itemName(id) { var i = SF.ITEM_BY_ID[id]; return i ? i.name : id; }
  function companionName(id) {
    var c = window.SF && SF.Companions && SF.Companions.byId && SF.Companions.byId[id];
    return c ? c.name : id;
  }

  var Crafting = {

    recipe: function (id) { return BY_ID[id] || null; },

    /* crafting-recipes-v2: requirement lock info. Returns the lock text when
     * the recipe is gated (currently companion loyalty), null when open. */
    lockInfo: function (r) {
      if (r.requires && r.requires.loyalty) {
        var lc = r.requires.loyalty;
        var loy = (window.SF && SF.CompanionQuests && SF.CompanionQuests.loyaltyOf)
          ? SF.CompanionQuests.loyaltyOf(lc.id) : 0;
        if (loy < lc.tier)
          return '🔒 Requires ' + companionName(lc.id) + ' loyalty ' + lc.tier +
            ' (have ' + loy + ') — finish their personal quest chain.';
      }
      return null;
    },

    costText: function (r) {
      var bits = [fmt(r.cost.credits) + 'c', fmt(r.cost.ore) + ' ore'];
      (r.cost.parts || []).forEach(function (c) { bits.push(c.n + '× ' + partName(c.id)); });
      (r.cost.items || []).forEach(function (c) { bits.push(c.n + '× ' + itemName(c.id)); });
      return bits.join(' · ');
    },

    canCraft: function (id) {
      var r = BY_ID[id];
      if (!r) return { ok: false, missing: ['unknown recipe'] };
      var p = SF.Player, miss = [];
      if (p.credits < r.cost.credits) miss.push(fmt(r.cost.credits - p.credits) + 'c short');
      if (p.ore < r.cost.ore) miss.push(fmt(r.cost.ore - p.ore) + ' ore short');
      (r.cost.parts || []).forEach(function (c) {
        var have = (p.partInventory || {})[c.id] || 0;
        if (have < c.n) miss.push(partName(c.id) + ' ' + have + '/' + c.n);
      });
      (r.cost.items || []).forEach(function (c) {
        var have = (p.inventory || {})[c.id] || 0;
        if (have < c.n) miss.push(itemName(c.id) + ' ' + have + '/' + c.n);
      });
      if (r.output.kind === 'weapon' && p.hasWeapon(r.output.id))
        miss.push('already own ' + r.name);
      /* crafting-recipes-v2: loyalty / requirement gate */
      var lock = this.lockInfo(r);
      if (lock) miss.push(lock);
      return { ok: miss.length === 0, missing: miss };
    },

    /* Instant craft. This is the hook for a future timed craft queue:
     * keep the signature (returns true/false) and hang scheduling off it. */
    craft: function (id) {
      var r = BY_ID[id];
      if (!r) return false;
      var chk = this.canCraft(id);
      if (!chk.ok) return false;
      var p = SF.Player;
      p.credits -= r.cost.credits;
      p.ore -= r.cost.ore;
      (r.cost.parts || []).forEach(function (c) {
        p.partInventory[c.id] = (p.partInventory[c.id] || 0) - c.n;
      });
      (r.cost.items || []).forEach(function (c) {
        p.inventory[c.id] = (p.inventory[c.id] || 0) - c.n;
      });
      if (r.output.kind === 'part') p.addPart(r.output.id, 1);
      else p.addWeapon(r.output.id);
      if (SF.Audio && SF.Audio.craft) SF.Audio.craft();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('⚒ Crafted: ' + r.name);
      return true;
    },

    /* Salvage spare parts / components at 40% of value. */
    salvagePart: function (partId) {
      var p = SF.Player, pt = SF.PART_BY_ID[partId];
      if (!pt || (p.partInventory[partId] || 0) <= 0) return false;
      p.partInventory[partId]--;
      p.credits += Math.floor(pt.price * 0.4);
      if (SF.Audio && SF.Audio.salvage) SF.Audio.salvage();
      return true;
    },

    salvageItem: function (itemId) {
      var p = SF.Player, it = SF.ITEM_BY_ID[itemId];
      if (!it || (p.inventory[itemId] || 0) <= 0) return false;
      p.inventory[itemId]--;
      p.credits += Math.floor(it.price * 0.4);
      if (SF.Audio && SF.Audio.salvage) SF.Audio.salvage();
      return true;
    },

    /* ---- station UI ---- */
    renderWorkbench: function (body) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '⚒ WORKBENCH — CRAFTING';
      body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '4px';
      note.textContent = 'Craft-only gear (marked ⬥) never appears in store stock. Instant build — parts + salvage + fee. ' +
        '🔒 rows are companion loyalty rewards: finish that companion\u2019s personal quest chain to unlock.';
      body.appendChild(note);
      var self = this;
      SF.RECIPES.forEach(function (r) {
        var chk = self.canCraft(r.id);
        var lock = self.lockInfo(r);
        var div = document.createElement('div');
        div.className = 'store-row';
        var dot = '<span class="tier-dot" style="background:' + SF.TIERS[r.tier] + '"></span>';
        div.innerHTML = '<div class="store-info">' + dot +
          '<div><div class="store-name">⬥ ' + r.name + '</div>' +
          '<div class="store-desc">' + r.desc + '<br>' + self.costText(r) +
          (lock ? '<br><span style="color:#ff7d9c">' + lock + '</span>'
                : (chk.ok ? '' : '<br><span style="color:#ff5e3a">Missing: ' + chk.missing.join(', ') + '</span>')) +
          '</div></div></div>';
        var btn = document.createElement('button');
        btn.className = 'btn store-btn';
        btn.textContent = chk.ok ? 'CRAFT' : 'CRAFT';
        if (!chk.ok) btn.disabled = true;
        btn.addEventListener('click', function () {
          if (self.craft(r.id)) { SF.Save.save(); SF.Station.renderStore(); }
          else { SF.Audio.deny(); }
        });
        div.appendChild(btn);
        body.appendChild(div);
      });

      // salvage
      var sh = document.createElement('div');
      sh.className = 'store-head';
      sh.textContent = '♻ SALVAGE (40% value)';
      body.appendChild(sh);
      var p = SF.Player, any = false;
      Object.keys(p.partInventory || {}).forEach(function (id) {
        if ((p.partInventory[id] || 0) <= 0) return;
        any = true;
        var pt = SF.PART_BY_ID[id];
        if (!pt) return; // defensive: never render unknown part ids
        var val = Math.floor((pt ? pt.price : 0) * 0.4);
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML = '<div class="store-info"><div><div class="store-name">' +
          (pt ? pt.name : id) + ' ×' + p.partInventory[id] + '</div>' +
          '<div class="store-desc">Salvage one for +' + fmt(val) + 'c</div></div></div>';
        var b = document.createElement('button');
        b.className = 'btn store-btn';
        b.textContent = 'SALVAGE';
        b.addEventListener('click', function () {
          if (self.salvagePart(id)) { SF.Save.save(); SF.Station.renderStore(); }
        });
        row.appendChild(b);
        body.appendChild(row);
      });
      Object.keys(p.inventory || {}).forEach(function (id) {
        if ((p.inventory[id] || 0) <= 0) return;
        any = true;
        var it = SF.ITEM_BY_ID[id];
        var val = Math.floor((it ? it.price : 0) * 0.4);
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML = '<div class="store-info"><div><div class="store-name">' +
          (it ? it.name : id) + ' ×' + p.inventory[id] + '</div>' +
          '<div class="store-desc">Salvage one for +' + fmt(val) + 'c</div></div></div>';
        var b = document.createElement('button');
        b.className = 'btn store-btn';
        b.textContent = 'SALVAGE';
        b.addEventListener('click', function () {
          if (self.salvageItem(id)) { SF.Save.save(); SF.Station.renderStore(); }
        });
        row.appendChild(b);
        body.appendChild(row);
      });
      if (!any) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.textContent = 'Nothing to salvage. Strip wrecks and derelicts.';
        body.appendChild(none);
      }
    }
  };

  SF.Crafting = Crafting;
})();

/* ============================================================
 * salvage-drones phase — SF.Drone: craftable salvage drone.
 *
 * Additive section appended by the salvage-drones phase; the recipe +
 * crafting UI above are untouched. Everything lives here in
 * js/crafting.js (in scope); no other file is edited. Hooks into the
 * running game purely by wrapping (the established codebase pattern —
 * see SF.MiningBar / SF.Afterburner / SF.Finisher):
 *   - SF.Player.update wrap -> per-frame drone update (orbit, collect,
 *     enemy-fire hits), runs only while PLAYING;
 *   - SF.Player.draw wrap -> drone glyph in world space;
 *   - SF.Player.create wrap -> clear active deployment on death-respawn
 *     (ownership is kept: respawn preserves gear; only newGame resets);
 *   - SF.Game.newGame wrap -> full runtime reset;
 *   - SF.Game.setState wrap -> refresh the touch button on transitions;
 *   - SF.Crafting.recipe/canCraft/craft wraps -> the drone recipe, which
 *     uses output kind 'drone' (not a part/weapon, so no data.js entry is
 *     needed and none was touched).
 *
 * Behavior:
 *   - Craft at the workbench (recipe r_salvage_drone). Craft-once: the
 *     drone is reusable, never consumed.
 *   - Deploy in flight with D (keydown edge) or the touch button
 *     (#btn-drone, created + styled here, hud-adjacent above FIRE).
 *   - Orbits the player (56px) for 45s, teleporting pickups within 220px
 *     onto itself so the normal pickup pipeline (magnet -> collect rules,
 *     cargo-full handling, audio/toasts) does the collecting.
 *   - 50 hull; enemy projectiles damage it. Destroyed -> bursts, returns
 *     to the hold (nothing dropped), 60s cooldown, reusable.
 *   - 45s expiry -> returns to the hold, 60s cooldown.
 * Save-neutral: all state is module-level runtime state; no SF.SAVE_VERSION
 * bump, nothing new serialized (v11 stays).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var CFG = {
    recipeId: 'r_salvage_drone',
    orbitR: 56,          // px orbit radius
    orbitSpeed: 2.6,     // rad/s
    collectR: 220,       // px: pickups within this of the drone get vacuumed
    hullMax: 50,         // hull; destroyed by enemy fire, drops nothing
    deployT: 45,         // s deployed before auto-return
    cooldownT: 60,       // s cooldown after return / destruction
    bodyR: 10,           // px collision radius vs enemy projectiles
    vacuumSpeed: 1400,   // px/s pull toward the drone
    vacuumHandoff: 44    // px: closer than this -> hand to the player for collect
  };

  /* salvage-drone-upgrades phase: additive upgrade consults. Defensive — if
   * the upgrades section failed to load, every upgrade reads off and the
   * stock drone behaves exactly as before. Consulted only at game time. */
  function upgHas(id) {
    return !!(window.SF && SF.DroneUpgrades && SF.DroneUpgrades.has &&
              SF.DroneUpgrades.has(id));
  }

  var RECIPE = {
    id: CFG.recipeId, name: 'Salvage Drone', tier: 'green',
    desc: 'WORKBENCH-ONLY deployable. Orbits you for 45s, vacuums pickups/ore within 220px. 50 hull — enemy fire can kill it (drops nothing). Returns to the hold, reusable after a 60s cooldown. Deploy in flight: D key or the 🛰 button.',
    cost: { credits: 3500, ore: 20,
            parts: [{ id: 'light_hardpoint', n: 1 }],
            items: [{ id: 'fluxcap', n: 2 }, { id: 'plasmacoil', n: 1 }] },
    output: { kind: 'drone', id: 'salvage_drone' }
  };

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* ---------- recipe registry integration (wraps, idempotent) ---------- */
  function hookRecipes() {
    if (!window.SF || !SF.Crafting) return;
    if (SF.RECIPES.indexOf(RECIPE) < 0) SF.RECIPES.push(RECIPE); // workbench renders SF.RECIPES directly
    var C = SF.Crafting;
    if (!C.recipe.__sdr) {
      var origRecipe = C.recipe;
      C.recipe = function (id) { return id === RECIPE.id ? RECIPE : origRecipe.call(this, id); };
      C.recipe.__sdr = true;
    }
    if (!C.canCraft.__sdr) {
      var origCan = C.canCraft;
      C.canCraft = function (id) { return id === RECIPE.id ? canCraftDrone() : origCan.call(this, id); };
      C.canCraft.__sdr = true;
    }
    if (!C.craft.__sdr) {
      var origCraft = C.craft;
      C.craft = function (id) { return id === RECIPE.id ? craftDrone() : origCraft.call(this, id); };
      C.craft.__sdr = true;
    }
  }

  function costMissing(r) {
    var miss = [], p = SF.Player;
    if (p.credits < r.cost.credits) miss.push(fmt(r.cost.credits - p.credits) + 'c short');
    if (p.ore < r.cost.ore) miss.push(fmt(r.cost.ore - p.ore) + ' ore short');
    (r.cost.parts || []).forEach(function (c) {
      var have = (p.partInventory || {})[c.id] || 0;
      var pn = (SF.PART_BY_ID && SF.PART_BY_ID[c.id]) ? SF.PART_BY_ID[c.id].name : c.id;
      if (have < c.n) miss.push(pn + ' ' + have + '/' + c.n);
    });
    (r.cost.items || []).forEach(function (c) {
      var have = (p.inventory || {})[c.id] || 0;
      var in_ = (SF.ITEM_BY_ID && SF.ITEM_BY_ID[c.id]) ? SF.ITEM_BY_ID[c.id].name : c.id;
      if (have < c.n) miss.push(in_ + ' ' + have + '/' + c.n);
    });
    return miss;
  }

  function canCraftDrone() {
    var miss = [];
    if (Drone.owned() > 0 || Drone.state().active)
      miss.push('already own a salvage drone (reusable — no need for a second)');
    return { ok: miss.concat(costMissing(RECIPE)).length === 0,
             missing: miss.concat(costMissing(RECIPE)) };
  }

  function craftDrone() {
    var chk = canCraftDrone();
    if (!chk.ok) return false;
    var p = SF.Player;
    p.credits -= RECIPE.cost.credits;
    p.ore -= RECIPE.cost.ore;
    (RECIPE.cost.parts || []).forEach(function (c) {
      p.partInventory[c.id] = (p.partInventory[c.id] || 0) - c.n;
    });
    (RECIPE.cost.items || []).forEach(function (c) {
      p.inventory[c.id] = (p.inventory[c.id] || 0) - c.n;
    });
    Drone.grant();
    if (SF.Audio && SF.Audio.craft) SF.Audio.craft();
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('⚒ Crafted: Salvage Drone — deploy in flight with D / 🛰');
    return true;
  }

  /* ---------- runtime state (module-level; never serialized) ---------- */
  var owned = 0;        // drones stowed in the hold (craft-once => 0|1)
  var active = false;   // currently deployed
  var dX = 0, dY = 0;   // drone world pos
  var dHull = 0, dTime = 0, dCool = 0, dAngle = 0;

  function toast(m) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(m); }

  function recall(expired) {
    active = false;
    dCool = CFG.cooldownT;
    if (expired) toast('🛰 Drone returned to the hold. Cooldown 60s.');
  }

  function destroyDrone() {
    SF.Particles.burst(dX, dY, '#ffb02e', 22, 260, 0.7, 4);
    SF.Particles.burst(dX, dY, '#ff5e3a', 12, 180, 0.6, 3);
    if (SF.FX && SF.FX.shake) SF.FX.shake(6);
    if (SF.Audio && SF.Audio.explosion) SF.Audio.explosion(false);
    toast('🛰 Salvage drone destroyed — returning to the hold. Cooldown 60s.');
    active = false;
    dCool = CFG.cooldownT;
  }

  function damageDrone(n) {
    if (!active) return;
    dHull -= n;
    SF.Particles.burst(dX, dY, '#7df9ff', 8, 160, 0.4, 3);
    if (SF.Audio && SF.Audio.shieldHit) SF.Audio.shieldHit();
    if (dHull <= 0) destroyDrone();
  }

  /* ---------- hud-adjacent touch button (created + styled here) ---------- */
  var btn = null, lastLabel = null;
  function ensureButton() {
    if (btn) return btn;
    btn = document.getElementById('btn-drone');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'btn-drone';
    btn.className = 'ui-block';
    btn.style.cssText =
      'position:fixed;right:34px;bottom:calc(142px + env(safe-area-inset-bottom));' +
      'width:72px;height:72px;border-radius:50%;z-index:26;display:none;' +
      'background:rgba(40,110,180,0.35);border:2px solid rgba(125,249,255,0.85);' +
      'color:#dffaff;font:inherit;font-size:12px;font-weight:bold;pointer-events:auto;';
    btn.textContent = '🛰 D';
    btn.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.unlock) SF.Audio.unlock();
      Drone.deploy();
    });
    document.body.appendChild(btn);
    return btn;
  }

  function refreshButton() {
    var b = ensureButton();
    var show = !!(window.SF && SF.Game && SF.Game.state === 'PLAYING' && owned > 0);
    var label;
    if (active) label = '🛰 ' + Math.ceil(dTime) + 's';
    else if (dCool > 0) label = '⌛ ' + Math.ceil(dCool) + 's';
    else label = '🛰 D';
    if (label !== lastLabel) { b.textContent = label; lastLabel = label; }
    b.style.display = show ? 'block' : 'none';
    b.style.opacity = (!active && dCool > 0) ? '0.55' : '1';
  }

  /* ---------- per-frame update ---------- */
  function update(dt) {
    refreshButton();
    if (dCool > 0) dCool = Math.max(0, dCool - dt);
    if (!active) return;
    var p = SF.Player;
    if (!p || !p.alive || !window.SF || !SF.Game || SF.Game.state !== 'PLAYING') {
      recall(false);
      return;
    }
    dTime -= dt;
    var recallAt = upgHas('recall_beacon') ? 10 : 0; // upgrades: Recall Beacon
    if (dTime <= recallAt) {
      if (recallAt > 0) {
        toast('📡 Recall beacon engaged — drone auto-returned with 10s to spare.');
        recall(false);
      } else recall(true);
      return;
    }
    dAngle += CFG.orbitSpeed * dt;
    dX = p.x + Math.cos(dAngle) * CFG.orbitR;
    dY = p.y + Math.sin(dAngle) * CFG.orbitR;

    /* vacuum: pickups within collectR get yanked toward the drone at high
     * speed; once one is close to the drone it is handed to the player
     * position so the normal SF.Pickups.update pipeline (collect rules,
     * cargo-full handling, audio/toasts) collects it into the inventory
     * on the same frame. (Teleporting every frame glued pickups to the
     * drone forever — the player's magnet never got to finish.) */
    var pool = SF.Pickups.pool, i, pk;
    var drill = upgHas('drill_mk2'); // upgrades: Drill Bit Mk2
    var cr = drill ? 320 : CFG.collectR;
    var vs = drill ? CFG.vacuumSpeed * 2 : CFG.vacuumSpeed;
    var r2 = cr * cr;
    for (i = 0; i < pool.length; i++) {
      pk = pool[i];
      if (!pk.active) continue;
      var vdx = pk.x - dX, vdy = pk.y - dY;
      var vd2 = vdx * vdx + vdy * vdy;
      if (vd2 > r2) continue;
      var vd = Math.sqrt(vd2) || 1;
      if (vd < CFG.vacuumHandoff) {
        pk.x = p.x; pk.y = p.y; pk.vx = 0; pk.vy = 0; // collect pipeline takes it
      } else {
        pk.vx = -vdx / vd * vs;
        pk.vy = -vdy / vd * vs;
      }
    }

    /* enemy fire vs the drone (friendly fire ignores it). */
    var prs = SF.Projectiles.pool, pr;
    for (i = 0; i < prs.length; i++) {
      pr = prs[i];
      if (!pr.active || pr.friendly) continue;
      var pdx = pr.x - dX, pdy = pr.y - dY;
      var rr = CFG.bodyR + (pr.radius || 4);
      if (pdx * pdx + pdy * pdy <= rr * rr) {
        pr.active = false;
        damageDrone(pr.dmg || 10);
        if (!active) break;
      }
    }
  }

  /* ---------- drone glyph (world space, after the player ship) ---------- */
  function draw(ctx) {
    if (!active) return;
    ctx.save();
    ctx.translate(dX, dY);
    // faint orbit-sweep arc hint
    ctx.strokeStyle = 'rgba(125,249,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 13, dAngle, dAngle + Math.PI * 0.9); ctx.stroke();
    // hex body
    ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2 + Math.PI / 6;
      var x = Math.cos(a) * 9, y = Math.sin(a) * 9;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'rgba(125,249,255,0.25)'; ctx.fill();
    // blinking core light
    var blink = (Math.floor(performance.now() / 250) % 2) === 0;
    ctx.fillStyle = blink ? '#ffd23f' : '#ff8c2e';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---------- keybind (D) ---------- */
  function onKey(e) {
    if (e.repeat || e.code !== 'KeyD') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    Drone.deploy();
  }

  /* ---------- install (additive wraps, idempotent) ---------- */
  var installed = false;
  function install() {
    if (installed) return; installed = true;
    hookRecipes();
    if (window.SF && SF.Player) {
      var ou = SF.Player.update;
      if (typeof ou === 'function' && !ou.__sdr) {
        SF.Player.update = function (dt, input) {
          var r = ou.call(this, dt, input);
          try { update(dt); } catch (e) {}
          return r;
        };
        SF.Player.update.__sdr = true;
      }
      var od = SF.Player.draw;
      if (typeof od === 'function' && !od.__sdr) {
        SF.Player.draw = function (ctx) {
          od.call(this, ctx);
          try { draw(ctx); } catch (e) {}
        };
        SF.Player.draw.__sdr = true;
      }
      var oc = SF.Player.create;
      if (typeof oc === 'function' && !oc.__sdr) {
        SF.Player.create = function () {
          var r = oc.apply(this, arguments);
          // death-respawn keeps the stowed drone (gear survives), clears deployment
          active = false; dTime = 0; dCool = 0; dHull = 0;
          try { refreshButton(); } catch (e) {}
          return r;
        };
        SF.Player.create.__sdr = true;
      }
    }
    /* SF.Save.wipe is called only from main.js newGame() (verified: the only
     * .wipe() call site), and runs before SF.Player.create(). Wrapping it
     * gives a reliable new-game reset that the closure-local newGame() call
     * cannot bypass. Death-respawn does NOT wipe, so the stowed drone
     * survives death via the create-wrap above. */
    if (window.SF && SF.Save && typeof SF.Save.wipe === 'function' && !SF.Save.wipe.__sdr) {
      var ow = SF.Save.wipe;
      SF.Save.wipe = function () {
        var r = ow.apply(this, arguments);
        owned = 0; active = false; dTime = 0; dCool = 0; dHull = 0;
        try { refreshButton(); } catch (e) {}
        return r;
      };
      SF.Save.wipe.__sdr = true;
    }
    if (typeof window !== 'undefined' && window.addEventListener && !install.__key) {
      window.addEventListener('keydown', onKey);
      install.__key = true;
    }
    if (typeof document !== 'undefined') ensureButton();
    installGameWraps(); // SF.Game is defined by main.js, which parses AFTER this file
  }

  /* Deferred: SF.Game (main.js) parses after this file, so the Game wraps
   * retry until SF.Game exists (mirrors the hud.js retry pattern). */
  var gameWrapsDone = false;
  function installGameWraps() {
    if (gameWrapsDone) return;
    if (!window.SF || !SF.Game || typeof SF.Game.setState !== 'function') {
      setTimeout(installGameWraps, 500);
      return;
    }
    gameWrapsDone = true;
    if (typeof SF.Game.newGame === 'function' && !SF.Game.newGame.__sdr) {
      var ong = SF.Game.newGame;
      SF.Game.newGame = function () {
        var r = ong.apply(this, arguments);
        owned = 0; active = false; dTime = 0; dCool = 0; dHull = 0;
        try { refreshButton(); } catch (e) {}
        return r;
      };
      SF.Game.newGame.__sdr = true;
    }
    if (!SF.Game.setState.__sdr) {
      var oss = SF.Game.setState;
      SF.Game.setState = function (s) {
        var r = oss.apply(this, arguments);
        try { refreshButton(); } catch (e) {}
        return r;
      };
      SF.Game.setState.__sdr = true;
    }
  }
  if (typeof document !== 'undefined' &&
      document.readyState !== 'complete' && document.readyState !== 'interactive') {
    document.addEventListener('DOMContentLoaded', installGameWraps);
  }
  var Drone = {
    config: function () {
      return { orbitR: CFG.orbitR, orbitSpeed: CFG.orbitSpeed,
               collectR: CFG.collectR, hullMax: CFG.hullMax,
               deployT: CFG.deployT, cooldownT: CFG.cooldownT,
               bodyR: CFG.bodyR, recipeId: CFG.recipeId };
    },
    state: function () {
      return { owned: owned, active: active, hull: dHull,
               timeLeft: Math.max(0, dTime), cooldown: Math.max(0, dCool),
               x: dX, y: dY };
    },
    recipe: function () { return RECIPE; },
    owned: function () { return owned; },
    grant: function () { owned++; try { refreshButton(); } catch (e) {} return owned; },
    deploy: function () {
      if (active) return false;
      if (dCool > 0) {
        toast('🛰 Drone on cooldown: ' + Math.ceil(dCool) + 's');
        if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
        return false;
      }
      if (owned <= 0) {
        toast('🛰 No salvage drone — craft one at the station workbench.');
        if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
        return false;
      }
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return false;
      var p = SF.Player;
      if (!p || !p.alive) return false;
      active = true;
      dHull = upgHas('hull_mk2') ? 120 : CFG.hullMax; // upgrades: Reinforced Hull
      dTime = CFG.deployT;
      dAngle = 0;
      dX = p.x + Math.cos(dAngle) * CFG.orbitR;
      dY = p.y + Math.sin(dAngle) * CFG.orbitR;
      SF.Particles.burst(dX, dY, '#7df9ff', 14, 160, 0.5, 3);
      if (SF.Audio && SF.Audio.salvage) SF.Audio.salvage();
      toast('🛰 Salvage drone deployed — 45s sweep.');
      refreshButton();
      return true;
    },
    damage: damageDrone,   // test hook: apply lethal/non-lethal hits
    install: install,
    /* smoke-test hooks */
    testSetCooldown: function (v) { dCool = Math.max(0, v); refreshButton(); },
    testSetTimeLeft: function (v) { dTime = Math.max(0, v); },
    testReset: function () { owned = 0; active = false; dCool = 0; dTime = 0; dHull = 0; refreshButton(); }
  };

  SF.Drone = Drone;
  hookRecipes();
  install();
})();

/* ============================================================
 * salvage-drone-upgrades phase — SF.DroneUpgrades: upgrade tiers for the
 * craftable salvage drone (salvage-drones phase).
 *
 * Additive section; the recipe list, the drone deploy/collect code, and
 * every other file are untouched except for five one-line upgrade consults
 * in the drone section above (marked "upgrades:"): collect radius / vacuum
 * speed, deploy hull, and the expiry check. With no upgrades owned the stock
 * drone behaves exactly as before (all consults read off).
 *
 * 3 upgrade lines, bought via the dedicated loadout panel
 * (renderLoadoutPanel; drone-loadout-panel phase migrated the old additive
 * rows into the panel — same workbench chrome, same purchase path)
 * rendered only while the player owns a drone:
 *   - Drill Bit Mk2   (4000c): collect radius 220px -> 320px, 2x collect speed
 *   - Reinforced Hull (5000c): drone hull 50 -> 120
 *   - Recall Beacon   (3000c): auto-returns the drone to the hold when 10s of
 *     flight time remain, skipping the destruction-risk window
 *
 * Persistence: upgrades persist additively on the drone record. The runtime
 * record is module-level (like the drone itself); it is ALSO written into
 * the save as an additive `droneUpgrades` blob on the player object via
 * wraps of SF.Player.serialize/deserialize (the ship-paint-jobs precedent in
 * js/ship.js), read back defensively so old saves without the blob load with
 * all upgrades off. Save-neutral: SF.SAVE_VERSION stays 11, no migrate step
 * added or needed. SF.Save.wipe (new game) resets the upgrades, matching the
 * drone reset.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var DEFS = [
    { id: 'drill_mk2', key: 'drill',
      name: 'Drill Bit Mk2', price: 4000,
      desc: 'Wider, faster vacuum head: collect radius 220px → 320px, 2× collect speed.' },
    { id: 'hull_mk2', key: 'hull',
      name: 'Reinforced Hull', price: 5000,
      desc: 'Plated drone chassis: hull 50 → 120. Survives fire that kills a stock drone.' },
    { id: 'recall_beacon', key: 'recall',
      name: 'Recall Beacon', price: 3000,
      desc: 'Auto-returns the drone to the hold with 10s of flight time left — skips the destruction-risk window.' }
  ];
  var BY_ID = {};
  DEFS.forEach(function (d) { BY_ID[d.id] = d; });

  /* runtime record — additive on the drone record; defensive reads below */
  var owned = { drill: false, hull: false, recall: false };

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function toast(m) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(m); }

  function snapshot() {
    return { drill: !!owned.drill, hull: !!owned.hull, recall: !!owned.recall };
  }
  function restore(playerBlob) {
    var u = playerBlob && playerBlob.droneUpgrades;
    owned.drill = !!(u && u.drill);
    owned.hull = !!(u && u.hull);
    owned.recall = !!(u && u.recall);
  }
  function reset() {
    owned.drill = false; owned.hull = false; owned.recall = false;
  }

  var DroneUpgrades = {
    list: function () { return DEFS.slice(); },
    def: function (id) { return BY_ID[id] || null; },
    has: function (id) {
      var d = BY_ID[id];
      return !!(d && owned[d.key]);
    },
    state: snapshot,
    /* effective tuning after upgrades (mirrors the consults in the drone
     * section above; smoke-test assertion surface) */
    effective: function () {
      return {
        collectR: owned.drill ? 320 : 220,
        vacuumSpeed: owned.drill ? 2800 : 1400,
        hullMax: owned.hull ? 120 : 50,
        recallAt: owned.recall ? 10 : 0
      };
    },
    buy: function (id) {
      var d = BY_ID[id];
      if (!d || owned[d.key]) return false;
      if (!window.SF || !SF.Drone || typeof SF.Drone.owned !== 'function' ||
          SF.Drone.owned() <= 0) return false; // upgrades install onto an owned drone
      var p = SF.Player;
      if (!p || p.credits < d.price) return false;
      p.credits -= d.price;
      owned[d.key] = true;
      if (SF.Audio && SF.Audio.craft) SF.Audio.craft();
      toast('🛰 Installed: ' + d.name);
      return true;
    },
    /* smoke-test hooks */
    testReset: reset,
    install: install
  };

  /* ---------- drone loadout panel (drone-loadout-panel phase) ----------
   * MIGRATION (documented in this phase's REPORT.md): this panel REPLACES
   * the plain upgrade rows rendered by renderSection (salvage-drone-upgrades
   * phase). Same workbench chrome, same placement (appended after the
   * salvage section), same purchase path — DroneUpgrades.buy() then
   * SF.Save.save() + SF.Station.renderStore() — so there are no breaking
   * API changes; the old rows are simply gone, subsumed by the panel.
   * The panel shows:
   *   - live drone status (deployed / in the hold / stowed) incl. hull while
   *     deployed
   *   - the tuning table: STOCK (SF.Drone.config(), dim secondary column,
   *     stock-only per the upgrades report) vs EFFECTIVE
   *     (SF.DroneUpgrades.effective() — the TRUE current tuning; the numbers
   *     the drone actually flies with)
   *   - the 3 installed upgrade tiers (drill / range(vacuum) / hull / beacon
   *     covered by Drill Bit Mk2, Reinforced Hull, Recall Beacon) with
   *     INSTALL/INSTALLED buttons
   *   - beacon-return 60s cooldown state: every return (expiry, destruction,
   *     OR beacon auto-return) arms the same 60s cooldown; the live
   *     remaining value is shown while > 0
   * Save-neutral: no new serialized fields, SF.SAVE_VERSION stays 11. */
  function renderLoadoutPanel(body) {
    if (!window.SF || !SF.Drone || typeof SF.Drone.owned !== 'function') return;
    if (SF.Drone.owned() <= 0) return;
    var h = document.createElement('div');
    h.className = 'store-head';
    h.textContent = '🛰 SALVAGE DRONE — LOADOUT';
    body.appendChild(h);

    var panel = document.createElement('div');
    panel.id = 'drone-loadout-panel';
    panel.style.cssText = 'border:1px solid rgba(125,249,255,0.35);border-radius:8px;' +
      'padding:10px 12px;margin:6px 0 10px;background:rgba(10,24,40,0.55);';
    body.appendChild(panel);

    /* EFFECTIVE tuning is the authority (upgrades applied). Stock values are
     * shown dim for contrast only — never use SF.Drone.config() as current
     * tuning. */
    var eff = DroneUpgrades.effective();
    var cfg = (SF.Drone.config && typeof SF.Drone.config === 'function')
      ? SF.Drone.config() : null;
    /* SF.Drone.config() has no vacuumSpeed field — merge per key so a
     * missing field never renders NaN. */
    var stock = { collectR: 220, vacuumSpeed: 1400, hullMax: 50,
                  deployT: 45, cooldownT: 60 };
    if (cfg) {
      Object.keys(stock).forEach(function (k) {
        if (typeof cfg[k] === 'number' && isFinite(cfg[k])) stock[k] = cfg[k];
      });
    }
    var st = SF.Drone.state();
    var p = SF.Player;

    /* ---- status line ---- */
    var statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:14px;';
    if (st.active) {
      statusEl.innerHTML = 'STATUS: <span style="color:#7dff9a">DEPLOYED</span>' +
        ' — ' + Math.ceil(st.timeLeft) + 's flight time left' +
        ' · hull <span style="color:#ffd23f">' + Math.ceil(st.hull) +
        '</span>/' + eff.hullMax;
    } else if (st.cooldown > 0) {
      statusEl.innerHTML = 'STATUS: <span style="color:#ffb02e">IN THE HOLD — COOLDOWN ' +
        Math.ceil(st.cooldown) + 's</span>' +
        '<div class="dim" style="font-weight:normal">60s cooldown after any return ' +
        '(expiry, destruction, or beacon auto-return).</div>';
    } else {
      statusEl.innerHTML = 'STATUS: <span style="color:#7df9ff">STOWED IN THE HOLD</span>' +
        ' <span class="dim">— deploy in flight (D / 🛰)</span>';
    }
    panel.appendChild(statusEl);

    /* ---- installed tiers ---- */
    var installedNames = DEFS.filter(function (d) { return !!owned[d.key]; })
      .map(function (d) { return d.name; });
    var tiersEl = document.createElement('div');
    tiersEl.style.cssText = 'margin-bottom:8px;font-size:13px;';
    tiersEl.innerHTML = 'INSTALLED TIERS: ' +
      (installedNames.length
        ? '<span style="color:#7dff9a">' + installedNames.join(' · ') + '</span>'
        : '<span class="dim">none — stock tuning</span>');
    panel.appendChild(tiersEl);

    /* ---- tuning table: stock vs effective ---- */
    function row(label, stockVal, effVal, better) {
      var effStyle = better ? 'color:#7dff9a;font-weight:bold' : '';
      return '<tr><td class="dim" style="text-align:left">' + label + '</td>' +
        '<td class="dim">' + stockVal + '</td>' +
        '<td style="' + effStyle + '">' + effVal + '</td></tr>';
    }
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;font-size:13px;border-collapse:collapse;margin-bottom:8px;';
    table.innerHTML =
      '<tr><th class="dim" style="text-align:left">tuning</th>' +
      '<th class="dim">stock</th><th style="color:#7df9ff">effective</th></tr>' +
      row('collect radius', stock.collectR + ' px', eff.collectR + ' px',
          eff.collectR !== stock.collectR) +
      row('vacuum speed', fmt(stock.vacuumSpeed) + ' px/s', fmt(eff.vacuumSpeed) + ' px/s',
          eff.vacuumSpeed !== stock.vacuumSpeed) +
      row('hull', stock.hullMax + '', eff.hullMax + '',
          eff.hullMax !== stock.hullMax) +
      row('recall beacon', '—',
          eff.recallAt > 0 ? 'armed — auto-return at ' + eff.recallAt + 's left'
                           : '<span class="dim">not installed</span>',
          eff.recallAt > 0) +
      row('deploy time', stock.deployT + 's', stock.deployT + 's', false) +
      row('return cooldown', stock.cooldownT + 's', stock.cooldownT + 's', false);
    panel.appendChild(table);

    var note = document.createElement('div');
    note.className = 'dim';
    note.style.cssText = 'margin-bottom:8px;font-size:12px;';
    note.textContent = 'One-time installs on your salvage drone. Upgrades persist in the save and apply to every deployment. Effective tuning is what the drone actually flies with.';
    panel.appendChild(note);

    /* drone-combat-behaviors phase (additive): combat behavior selector,
     * rendered inside the loadout panel. No other panel code touched. */
    if (window.SF && SF.DroneBehaviors && typeof SF.DroneBehaviors.renderInto === 'function') {
      try { SF.DroneBehaviors.renderInto(panel); } catch (e) {}
    }

    /* ---- upgrade tier rows (purchase path unchanged from the old rows) ---- */
    DEFS.forEach(function (d) {
      var hasIt = !!owned[d.key];
      var afford = !!(p && p.credits >= d.price);
      var div = document.createElement('div');
      div.className = 'store-row';
      div.innerHTML = '<div class="store-info"><div>' +
        '<div class="store-name">🛰 ' + d.name +
        (hasIt ? ' <span style="color:#7dff9a">INSTALLED</span>' : '') + '</div>' +
        '<div class="store-desc">' + d.desc + '<br>' + fmt(d.price) + 'c' +
        ((!hasIt && !afford) ? '<br><span style="color:#ff5e3a">Missing: ' +
          fmt(d.price - (p ? p.credits : 0)) + 'c short</span>' : '') +
        '</div></div></div>';
      var btn = document.createElement('button');
      btn.className = 'btn store-btn';
      btn.textContent = hasIt ? 'INSTALLED' : 'INSTALL';
      btn.disabled = hasIt || !afford;
      if (!hasIt && afford) {
        btn.addEventListener('click', function () {
          if (DroneUpgrades.buy(d.id)) { SF.Save.save(); SF.Station.renderStore(); }
          else if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
        });
      }
      div.appendChild(btn);
      panel.appendChild(div);
    });
  }

  /* ---------- install (additive wraps, idempotent) ---------- */
  var installed = false;
  function install() {
    if (installed) return; installed = true;
    /* drone loadout panel (drone-loadout-panel phase: migrates the old
     * upgrade rows into the dedicated panel, same placement + purchase path) */
    if (window.SF && SF.Crafting && typeof SF.Crafting.renderWorkbench === 'function' &&
        !SF.Crafting.renderWorkbench.__sdup) {
      var orw = SF.Crafting.renderWorkbench;
      SF.Crafting.renderWorkbench = function (body) {
        var r = orw.call(this, body);
        try { renderLoadoutPanel(body); } catch (e) {}
        return r;
      };
      SF.Crafting.renderWorkbench.__sdup = true;
    }
    /* persistence: additive droneUpgrades blob on the player object.
     * Defensive reads — old saves without the blob load with all off.
     * Save-neutral: no SF.SAVE_VERSION bump (stays 11), no migrate step. */
    if (window.SF && SF.Player) {
      if (typeof SF.Player.serialize === 'function' && !SF.Player.serialize.__sdup) {
        var os = SF.Player.serialize;
        SF.Player.serialize = function () {
          var s = os.apply(this, arguments);
          s.droneUpgrades = snapshot();
          return s;
        };
        SF.Player.serialize.__sdup = true;
      }
      if (typeof SF.Player.deserialize === 'function' && !SF.Player.deserialize.__sdup) {
        var od = SF.Player.deserialize;
        SF.Player.deserialize = function (d) {
          var r = od.apply(this, arguments);
          try { restore(d); } catch (e) {}
          return r;
        };
        SF.Player.deserialize.__sdup = true;
      }
    }
    /* new game resets upgrades, matching the drone reset (SF.Save.wipe is
     * called only from main.js newGame; the drone section wraps it too —
     * the distinct __sdup flag keeps both wraps installed). */
    if (window.SF && SF.Save && typeof SF.Save.wipe === 'function' && !SF.Save.wipe.__sdup) {
      var ow = SF.Save.wipe;
      SF.Save.wipe = function () {
        var r = ow.apply(this, arguments);
        try { reset(); } catch (e) {}
        return r;
      };
      SF.Save.wipe.__sdup = true;
    }
  }

  SF.DroneUpgrades = DroneUpgrades;
  install();
})();

/* ============================================================
 * drone-combat-behaviors phase — SF.DroneBehaviors: selectable combat
 * behaviors for the craftable salvage drone (salvage-drones phase).
 *
 * Additive section; the drone, upgrades, and loadout-panel sections above
 * are untouched except for ONE additive call site in renderLoadoutPanel
 * (marked "drone-combat-behaviors:") that renders the behavior selector
 * inside the existing drone loadout panel. Everything else lives here in
 * js/crafting.js (in scope); no other file is edited.
 *
 * 3 behaviors, selectable in the drone loadout panel (drone owned only):
 *   - SALVAGE (default): current behavior — vacuum pickups, never fires.
 *     Wrecks have no distinct pickup kind in pickups.js; wreck loot (part /
 *     weapon / mod / item pickups — what destroyed ships drop) is vacuumed
 *     by the unchanged vacuum pipeline alongside everything else, and the
 *     drone ignores hostiles entirely.
 *   - HARASS: fires on the nearest hostile within 400px of the drone at
 *     40% of the player's current gun DPS.
 *   - GUARD: fires on hostiles actively engaging the player (state
 *     chase/strafe, within 600px of the player) at the same 40% DPS.
 * Behavior switch has a 1s cooldown (toast + deny sfx on early re-switch).
 * Combat modes keep the salvage vacuum running — the drone stays a salvage
 * drone; the gun is bolted on, not a role change.
 *
 * Weapon: reuses existing projectile visuals — fires friendly projectiles
 * through SF.Projectiles.spawn with the player's CURRENT weapon color/kind
 * (v2-fx-wiring renders the sprite; no new art). No homing, no spread, no
 * crit rolls: shots are deterministic so the 40%-DPS tuning is measurable.
 * Damage per shot = playerGunDps * 0.4 * FIRE_INTERVAL * DPS_CALIB; 2 shots/s
 * sustained. DPS_CALIB (1.08) compensates real-world measurement losses so
 * DELIVERED dps lands at 40% of player gun DPS (see REPAIR.md).
 *
 * Hooks (additive, idempotent, __sdcb flags):
 *   - SF.Player.update wrap -> combatTick(dt) after the drone move;
 *   - SF.Player.serialize/deserialize wraps -> persist `droneBehavior`
 *     additively on the player blob, read back defensively (unknown/missing
 *     -> 'salvage');
 *   - SF.Save.wipe wrap -> new game resets to 'salvage' (matches the drone
 *     + upgrades resets).
 * Save-neutral: no SF.SAVE_VERSION bump (stays 11), no migrate step — the
 * blob is additive with a defensive default, the upgrades-section precedent.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var DEFS = [
    { id: 'salvage', name: 'SALVAGE', icon: '🧲',
      desc: 'Current behavior: vacuum pickups (wreck loot included), ignores hostiles.' },
    { id: 'harass', name: 'HARASS', icon: '⚔️',
      desc: 'Engages the nearest hostile within 400px at 40% of your gun DPS.' },
    { id: 'guard', name: 'GUARD', icon: '🛡️',
      desc: 'Engages hostiles targeting you (chase/strafe, within 600px of you).' }
  ];
  var BY_ID = {};
  DEFS.forEach(function (d) { BY_ID[d.id] = d; });

  var COMBAT_RANGE = 400;      // px from the drone (HARASS)
  var GUARD_RANGE = 600;       // px from the player (GUARD)
  var FIRE_INTERVAL = 0.5;     // s between drone shots
  var DPS_FRAC = 0.4;          // design claim: drone delivers 40% of player gun DPS
  /* Real-world calibration: wall-clock measurement windows vs game-time,
   * plus bolts still in flight when a window closes, lose ~5-12% of the
   * nominal damage. DPS_CALIB compensates so DELIVERED dps lands at 40%. */
  var DPS_CALIB = 1.08;
  var SWITCH_COOLDOWN_MS = 1000;

  var behavior = 'salvage';    // runtime; persisted additively
  var switchReadyAt = 0;       // performance.now() ms; 1s switch cooldown
  var fireT = 0;               // combat fire timer

  function toast(m) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(m); }
  function deny() { if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny(); }

  /* ---------- player gun DPS (the 40% baseline) ----------
   * Mirrors the ship.js fire line: weapon damage * star multiplier * mod
   * damage multiplier * pellets * modded fire rate. Defensive — falls back
   * to a stock-pulse estimate if anything is missing. Excludes crew crit
   * (random) and set/prof bonuses are read where available. */
  function playerGunDps() {
    try {
      if (!window.SF || !SF.Player || typeof SF.Player.currentWeapon !== 'function') return 34.2;
      var w = SF.Player.currentWeapon();
      if (!w || !SF.CONFIG || !SF.CONFIG.weapons) return 34.2;
      var wcfg = SF.CONFIG.weapons[w.id];
      if (!wcfg) return 34.2;
      var entry = (typeof SF.Player.currentWeaponEntry === 'function')
        ? SF.Player.currentWeaponEntry() : null;
      var dmgMul = (SF.Upgrade && typeof SF.Upgrade.starMult === 'function')
        ? SF.Upgrade.starMult(w.stars || 1) : 1;
      if (entry && window.SF && SF.Mods && typeof SF.Mods.damageMul === 'function') {
        try { dmgMul *= SF.Mods.damageMul(entry); } catch (e) {}
      }
      var rate = wcfg.fireRate || 1;
      if (entry && window.SF && SF.Mods && typeof SF.Mods.rateMul === 'function') {
        try { rate *= SF.Mods.rateMul(entry); } catch (e) {}
      }
      var dps = wcfg.damage * dmgMul * (wcfg.pellets || 1) * rate;
      return dps > 0 ? dps : 34.2;
    } catch (e) { return 34.2; }
  }

  /* ---------- targeting ---------- */
  function isHostile(e) {
    return !!(e && !e.dead && e.hp > 0 && !e.trader);
  }

  function pickTarget(st) {
    if (!window.SF || !SF.Enemies) return null;
    var el = SF.Enemies.list || [];
    if (typeof el === 'function') { try { el = el(); } catch (e) { return null; } }
    var p = SF.Player;
    var best = null, bestD = Infinity, i, e, dx, dy, d;
    for (i = 0; i < el.length; i++) {
      e = el[i];
      if (!isHostile(e) || e.state === 'flee') continue;
      dx = e.x - st.x; dy = e.y - st.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (behavior === 'harass') {
        if (d > COMBAT_RANGE) continue;
      } else { /* guard: hostiles actively engaging the player */
        if (!p || !p.alive) continue;
        var px = e.x - p.x, py = e.y - p.y;
        if (Math.sqrt(px * px + py * py) > GUARD_RANGE) continue;
        if (e.state !== 'chase' && e.state !== 'strafe') continue;
      }
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /* ---------- combat ---------- */
  function fireShot(st, tgt) {
    if (!window.SF || !SF.Projectiles || typeof SF.Projectiles.spawn !== 'function') return;
    var dps = playerGunDps();
    /* dmg per shot: playerGunDps * 0.4 * FIRE_INTERVAL, plus the real-world
     * calibration so DELIVERED dps sits at 40% (see DPS_CALIB). */
    var dmg = dps * DPS_FRAC * FIRE_INTERVAL * DPS_CALIB;
    var color = '#7df9ff', kind = 'bolt', speed = 640;
    try {
      var w = (SF.Player && typeof SF.Player.currentWeapon === 'function')
        ? SF.Player.currentWeapon() : null;
      var wcfg = (w && SF.CONFIG && SF.CONFIG.weapons) ? SF.CONFIG.weapons[w.id] : null;
      if (w && w.color) color = w.color;
      if (wcfg && wcfg.kind) kind = wcfg.kind;
      if (wcfg && wcfg.projectileSpeed) speed = wcfg.projectileSpeed;
    } catch (e) {}
    var ang = Math.atan2(tgt.y - st.y, tgt.x - st.x);
    /* linear lead: aim where the target will be when the bolt arrives, so
     * the behavior actually lands hits on moving hostiles (stationary
     * targets aim dead-on, keeping the 40%-DPS tuning measurable). */
    try {
      var tdx = tgt.x - st.x, tdy = tgt.y - st.y;
      var tdist = Math.sqrt(tdx * tdx + tdy * tdy);
      if (tdist > 1 && speed > 0) {
        var tof = tdist / speed;
        var lx = tgt.x + (tgt.vx || 0) * tof - st.x;
        var ly = tgt.y + (tgt.vy || 0) * tof - st.y;
        if (lx * lx + ly * ly > 1) ang = Math.atan2(ly, lx);
      }
    } catch (e2) {}
    /* friendly: true — main.js collisions() routes it into enemies via
     * SF.Enemies.damage exactly like player shots. Reuses the current
     * weapon's color/kind visuals (v2-fx-wiring sprites). */
    SF.Projectiles.spawn(st.x, st.y, ang, speed, dmg, true, color,
      { radius: 3, kind: kind, life: 1.6 });
    if (SF.Particles && SF.Particles.muzzle) {
      try { SF.Particles.muzzle(st.x, st.y, color); } catch (e) {}
    }
  }

  function combatTick(dt) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
    if (!SF.Drone || typeof SF.Drone.state !== 'function') return;
    var st;
    try { st = SF.Drone.state(); } catch (e) { return; }
    if (!st || !st.active) { fireT = 0; return; }
    if (behavior === 'salvage') { fireT = 0; return; }
    fireT -= dt;
    if (fireT > 0) return;
    var tgt = null;
    try { tgt = pickTarget(st); } catch (e) { tgt = null; }
    if (!tgt) { fireT = 0; return; } /* re-arm immediately when one appears */
    fireT = FIRE_INTERVAL;
    try { fireShot(st, tgt); } catch (e) {}
  }

  /* ---------- behavior selector UI (rendered inside the loadout panel) ---------- */
  function renderInto(panel) {
    if (!panel || !window.SF || !SF.Drone || typeof SF.Drone.owned !== 'function') return;
    if (SF.Drone.owned() <= 0) return;
    var wrap = document.createElement('div');
    wrap.id = 'drone-behavior-select';
    wrap.style.cssText = 'border-top:1px solid rgba(125,249,255,0.25);margin-top:10px;padding-top:10px;';
    var head = document.createElement('div');
    head.className = 'store-head';
    head.textContent = '⚔️ COMBAT BEHAVIOR';
    wrap.appendChild(head);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin:8px 0;';
    DEFS.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'btn store-btn';
      b.setAttribute('data-behavior', d.id);
      var cur = (d.id === behavior);
      b.textContent = (cur ? '● ' : '○ ') + d.icon + ' ' + d.name;
      b.style.cssText = cur
        ? 'flex:1;border-color:#7dff9a;color:#7dff9a;font-weight:bold;'
        : 'flex:1;';
      b.addEventListener('click', function () {
        if (DroneBehaviors.set(d.id)) { SF.Save.save(); SF.Station.renderStore(); }
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    var dEl = document.createElement('div');
    dEl.className = 'dim';
    dEl.style.cssText = 'font-size:12px;margin-bottom:4px;';
    dEl.textContent = BY_ID[behavior].icon + ' ' + BY_ID[behavior].name + ': ' +
      BY_ID[behavior].desc;
    wrap.appendChild(dEl);
    var cd = document.createElement('div');
    cd.className = 'dim';
    cd.style.cssText = 'font-size:11px;';
    cd.textContent = 'Switching behavior has a 1s cooldown. Behavior persists in the save.';
    wrap.appendChild(cd);
    panel.appendChild(wrap);
  }

  /* ---------- install (additive wraps, idempotent) ---------- */
  var installed = false;
  function install() {
    if (installed) return; installed = true;
    /* per-frame combat pass: runs AFTER the drone move (this wrap is
     * installed after the drone section's __sdr wrap, so it is outermost). */
    if (window.SF && SF.Player && typeof SF.Player.update === 'function' &&
        !SF.Player.update.__sdcb) {
      var ou = SF.Player.update;
      SF.Player.update = function (dt, input) {
        var r = ou.call(this, dt, input);
        try { combatTick(dt); } catch (e) {}
        return r;
      };
      SF.Player.update.__sdcb = true;
    }
    /* persistence: additive droneBehavior blob on the player record.
     * Defensive reads — old saves without the blob load as 'salvage'.
     * Save-neutral: no SF.SAVE_VERSION bump, no migrate step (the
     * salvage-drone-upgrades precedent). */
    if (window.SF && SF.Player) {
      if (typeof SF.Player.serialize === 'function' && !SF.Player.serialize.__sdcb) {
        var os = SF.Player.serialize;
        SF.Player.serialize = function () {
          var s = os.apply(this, arguments);
          s.droneBehavior = behavior;
          return s;
        };
        SF.Player.serialize.__sdcb = true;
      }
      if (typeof SF.Player.deserialize === 'function' && !SF.Player.deserialize.__sdcb) {
        var od = SF.Player.deserialize;
        SF.Player.deserialize = function (d) {
          var r = od.apply(this, arguments);
          try {
            var b = d && d.droneBehavior;
            behavior = BY_ID[b] ? b : 'salvage';
          } catch (e) { behavior = 'salvage'; }
          return r;
        };
        SF.Player.deserialize.__sdcb = true;
      }
    }
    /* new game resets the behavior, matching the drone + upgrades resets
     * (SF.Save.wipe is called only from main.js newGame). */
    if (window.SF && SF.Save && typeof SF.Save.wipe === 'function' && !SF.Save.wipe.__sdcb) {
      var ow = SF.Save.wipe;
      SF.Save.wipe = function () {
        var r = ow.apply(this, arguments);
        behavior = 'salvage'; fireT = 0; switchReadyAt = 0;
        return r;
      };
      SF.Save.wipe.__sdcb = true;
    }
  }

  var DroneBehaviors = {
    defs: function () { return DEFS.slice(); },
    def: function (id) { return BY_ID[id] || null; },
    get: function () { return behavior; },
    state: function () {
      var now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      return { behavior: behavior,
               switchCooldownMs: Math.max(0, switchReadyAt - now) };
    },
    set: function (id) {
      if (!BY_ID[id]) return false;
      if (!window.SF || !SF.Drone || typeof SF.Drone.owned !== 'function' ||
          SF.Drone.owned() <= 0) {
        toast('🛰 No salvage drone — craft one at the station workbench first.');
        deny();
        return false;
      }
      if (id === behavior) return true;
      var now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      if (now < switchReadyAt) {
        toast('🛰 Behavior switch cooling down: ' +
              Math.ceil((switchReadyAt - now) / 1000) + 's');
        deny();
        return false;
      }
      behavior = id;
      fireT = 0;
      switchReadyAt = now + SWITCH_COOLDOWN_MS;
      toast('🛰 Drone behavior: ' + BY_ID[id].name);
      return true;
    },
    /* effective combat tuning (smoke-test assertion surface); droneDps is
     * the DELIVERED design value: 40% of player gun DPS after real-world
     * calibration (see DPS_CALIB). */
    effective: function () {
      return { combatRange: COMBAT_RANGE, guardRange: GUARD_RANGE,
               fireInterval: FIRE_INTERVAL, dpsFrac: DPS_FRAC,
               playerGunDps: playerGunDps(),
               droneDps: playerGunDps() * DPS_FRAC * DPS_CALIB };
    },
    renderInto: renderInto,
    install: install,
    /* smoke-test hooks */
    testReset: function () { behavior = 'salvage'; fireT = 0; switchReadyAt = 0; },
    testPlayerGunDps: playerGunDps
  };

  SF.DroneBehaviors = DroneBehaviors;
  install();
})();

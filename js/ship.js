/* STARFALL Phase 2 — ship.js
 * Player ship: hull HP, shield + regen, engine, weapon mounts.
 * Phase 2: owned ships (each a hull class + fitted parts), active ship's build
 * drives in-flight stats. Weapons are {id, stars}; damage scales with stars.
 */
window.SF = window.SF || {};

/* ---- power-profiles: reactor power profiles ----
 * Runtime-only switchable profiles (keybind B cycles, tap the ship.js-drawn
 * selector widget). Save-neutral: state lives on P.reactor, never serialized,
 * no SAVE_VERSION bump. Multipliers feed the existing stat pipeline through
 * profMul('dmg' | 'regen' | 'speed') as an additive wrap next to setMul().
 */
SF.REACTOR_PROFILES = [
  { id: 'balanced',  name: 'Balanced',  short: 'BAL', color: '#8fd0ff',
    hint: 'Neutral reactor output.',
    mul: { dmg: 1, regen: 1, speed: 1 } },
  { id: 'assault',   name: 'Assault',   short: 'AST', color: '#ff8c2e',
    hint: '+25% weapon damage, -20% shield regen.',
    mul: { dmg: 1.25, regen: 0.8, speed: 1 } },
  { id: 'aegis',     name: 'Aegis',     short: 'AEG', color: '#3fa9ff',
    hint: '+40% shield regen, -15% speed.',
    mul: { dmg: 1, regen: 1.4, speed: 0.85 } },
  { id: 'overdrive', name: 'Overdrive', short: 'OVR', color: '#ff4d6d',
    hint: '+30% speed, +15% damage. Heat builds; max heat = 10s forced vent.',
    mul: { dmg: 1.15, regen: 1, speed: 1.3 } }
];
SF.REACTOR_SWITCH_COOLDOWN = 3;  // seconds between profile switches
SF.REACTOR_VENT_TIME = 10;       // seconds of forced -50%-all-stats vent at max heat
SF.REACTOR_HEAT_RATE = 2.2;      // heat/s while in Overdrive (~45s to max)
SF.REACTOR_HEAT_COOL = 30;       // heat/s decayed when not in Overdrive

/* ============================================================
 * ship-paint-jobs: ship paint jobs.
 * 6 buyable tint palettes + the factory finish. Bought once each
 * (1500-6000c), applied as a tint overlay on the ship sprite draw.
 * The tint is source-atop composited at ~0.45 alpha onto an offscreen
 * copy of the sprite, so the class silhouette stays crisp and readable.
 * Ownership is account-wide: P.paint = { owned: {id:true}, active: id }.
 * Additive on the player blob, defensive reads everywhere — save-neutral,
 * NO SF.SAVE_VERSION bump.
 * NOTE (scope js/ship.js): the purchase/apply UI lives at the shipyard
 * (builder.js identity section / station.js), which is outside this
 * phase's file scope. SF.Player.paintJobs is the full buy/apply/render
 * API a follow-up phase wires; paintShopHTML() is the ready DOM snippet.
 * ============================================================ */
SF.PAINT_JOBS = [
  { id: 'factory', name: 'Factory Finish',   price: 0,    tint: null,      tintAlpha: 0,
    hint: 'Stock hull paint. No tint.' },
  { id: 'crimson', name: 'Crimson Corsair',   price: 1500, tint: '#d6304a',  tintAlpha: 0.45,
    hint: 'Blood-red war paint. Pirates notice.' },
  { id: 'azure',   name: 'Azure Drift',       price: 2400, tint: '#2b7fff',  tintAlpha: 0.45,
    hint: 'Deep-space blue. Calm, until it fires.' },
  { id: 'verdant', name: 'Verdant Vagabond',  price: 3200, tint: '#27c96a',  tintAlpha: 0.45,
    hint: 'Salvage-yard green with a clearcoat.' },
  { id: 'solar',   name: 'Solar Gilt',        price: 4200, tint: '#f2b134',  tintAlpha: 0.45,
    hint: 'Gold-foil raider finish. Expensive-looking.' },
  { id: 'void',    name: 'Void Violet',       price: 5200, tint: '#7b4fd6',  tintAlpha: 0.45,
    hint: 'Ultraviolet stealth sheen.' },
  { id: 'pearl',   name: 'Ghost Pearl',       price: 6000, tint: '#eaf2ff',  tintAlpha: 0.38,
    hint: 'Pearl-white showroom finish. Smells new.' },
  /* shop-launch: premium paints — Dark Matter only (premium: true).
   * buyPaintJob routes these through SF.Shop; credits can never
   * buy them. Also sold in the MENU drawer's SHOP panel. */
  { id: 'wraith',  name: 'Wraith Carbon',     price: 0, tint: '#171a24',  tintAlpha: 0.55,
    premium: true, dmPrice: 400,
    hint: 'Premium ◆. Near-black carbon weave. Barely there.' },
  { id: 'prism',   name: 'Prism Shift',       price: 0, tint: '#ff4fd8',  tintAlpha: 0.40,
    premium: true, dmPrice: 400,
    hint: 'Premium ◆. Hot-pink nebula sheen. The opposite of stealth.' },
  { id: 'gilded',  name: 'Supporter Gilt',    price: 0, tint: '#ffd23f',  tintAlpha: 0.50,
    premium: true, dmPrice: 800,
    hint: 'Premium ◆. Solid-gold supporter finish. Also in the Supporter Pack.' }
];

/* ============================================================
 * wingman-formations phase: formation orders for hired wingmen.
 *
 * Each ACTIVE wingman slot carries a formation assignment (delta /
 * spearhead / spread), switchable in flight via a small
 * ship.js-drawn canvas selector (tap a wingman's chip to cycle).
 *
 * Formations shift the wingman's combat ANCHOR offsets (the point the
 * phase-3-crew AI steers toward) plus combat multipliers:
 *   delta      — trailing triangle (same anchor as the base AI):
 *                -10% enemy hit chance vs the wingman (hitTakenMul 0.9)
 *   spearhead  — tight forward wedge:
 *                +15% wingman damage dealt, +20% wingman damage taken
 *   spread     — wide line abreast: +30% wingman sensor radius
 *                (engagement range 520 -> 676 via an additive sensor pass)
 *
 * Purely additive: the phase-3-crew AI in quests.js is NOT edited.
 * Integration is all wraps (flag __wmf, idempotent):
 *   - SF.Companions.update: sensor pre-pass (spread only, fires only at
 *     targets the base AI would NOT engage, same 0.55s cadence, never
 *     double-fires) + formation steering post-pass (delta == base
 *     anchor, so the post-pass skips delta and cannot fight the AI).
 *   - SF.Companions.loyaltyDmgMul: chains (base * loyalty * gear *
 *     formation dmgDealtMul). Only consumed by the wingman AI fire line.
 *   - SF.Companions.toggleActive: defaults new wingman records to
 *     'delta' (defensive reads cover older saves anyway).
 *
 * Save-neutral: formation lives additively on the wingman record
 * ({id, x, y, formation}); ship.js serialize() already deep-copies
 * the whole companions blob, so it persists with NO SF.SAVE_VERSION
 * bump. Unknown/missing formation ids read as 'delta'.
 *
 * Damage-taken hooks (hitTakenMul / dmgTakenMul) are exposed as
 * SF.WingmanFormations API: wingmen are untargetable by design
 * (enemies.js), so no live damage path consumes them today — future
 * phases (splash-capable enemies, wingman HP) can multiply through
 * them without touching this code.
 * ============================================================ */
SF.WINGMAN_FORMATIONS = [
  { id: 'delta', name: 'Delta', short: 'DLT', color: '#9fd8ff',
    hint: 'Trailing triangle. -10% enemy hit chance vs wingmen.',
    anchor: { back: 70, side: 60 },
    hitTakenMul: 0.9, dmgDealtMul: 1, dmgTakenMul: 1, sensorMul: 1 },
  { id: 'spearhead', name: 'Spearhead', short: 'SPR', color: '#ff8c2e',
    hint: 'Tight forward wedge. +15% wingman damage, +20% damage taken.',
    anchor: { back: -60, side: 28 },
    hitTakenMul: 1, dmgDealtMul: 1.15, dmgTakenMul: 1.2, sensorMul: 1 },
  { id: 'spread', name: 'Spread', short: 'SPD', color: '#57d98a',
    hint: 'Wide line abreast. +30% wingman sensor radius.',
    anchor: { back: 20, side: 140 },
    hitTakenMul: 1, dmgDealtMul: 1, dmgTakenMul: 1, sensorMul: 1.3 }
];
SF.WINGMAN_BASE_ENGAGE = 520; /* matches the phase-3-crew AI fire range */

(function () {
  'use strict';
  var SF = window.SF = window.SF || {};

  var BY_ID = {};
  SF.WINGMAN_FORMATIONS.forEach(function (f) { BY_ID[f.id] = f; });
  var DEFAULT_ID = 'delta';

  function validId(id) { return !!(id && BY_ID[id]); }

  /* Defensive formation def for a wingman record. */
  function get(w) {
    var id = (w && validId(w.formation)) ? w.formation : DEFAULT_ID;
    return BY_ID[id];
  }

  /* Anchor for wingman slot idx — same formula as the phase-3-crew AI
   * (tx = p.x - cos(a)*back - sin(a)*side). Delta reproduces the base
   * AI's behind-left / behind-right triangle exactly. */
  function anchorFor(w, idx, px, py, angle) {
    var def = get(w);
    var back = def.anchor.back;
    var side = def.anchor.side * (idx === 0 ? -1 : 1);
    return {
      x: px - Math.cos(angle) * back - Math.sin(angle) * side,
      y: py - Math.sin(angle) * back + Math.cos(angle) * side
    };
  }

  function enemyList() {
    var l = (window.SF && SF.Enemies) ? SF.Enemies.list : null;
    return (typeof l === 'function') ? l() : (l || []);
  }

  function activeWingmen() {
    if (!window.SF || !SF.Companions || !SF.Companions.active) return [];
    try { return SF.Companions.active() || []; } catch (e) { return []; }
  }

  /* Sensor pre-pass: spread wingmen engage targets the base AI ignores.
   * Runs BEFORE the base update; fires ONLY when (a) no enemy is within
   * the base 520 range (so the base AI would stay silent) and (b) an
   * enemy is within the extended range. Same 0.55s cadence + damage
   * line as the base AI — total fire rate is unchanged, reach grows. */
  function sensorPass() {
    if (!window.SF || !SF.Companions || !SF.Companions.byId) return;
    if (!SF.Game || SF.Game.state !== 'PLAYING') return;
    var act = activeWingmen();
    var el = enemyList();
    for (var i = 0; i < act.length; i++) {
      var w = act[i];
      var def = get(w);
      if (def.sensorMul <= 1) continue;
      if ((w.cool || 0) > 0) continue;
      var cdef = SF.Companions.byId[w.id];
      if (!cdef) continue;
      var baseR = SF.WINGMAN_BASE_ENGAGE, extR = baseR * def.sensorMul;
      var near = null, far = null, farD = extR;
      for (var j = 0; j < el.length; j++) {
        var e = el[j];
        if (!e || e.dead) continue;
        var d = Math.hypot(e.x - w.x, e.y - w.y);
        if (d < baseR) { near = e; break; }
        if (d < farD) { farD = d; far = e; }
      }
      if (near || !far) continue; /* base AI handles near; nothing far */
      w.cool = 0.55;
      var ang = Math.atan2(far.y - w.y, far.x - w.x);
      var mul = (SF.Companions.loyaltyDmgMul)
        ? SF.Companions.loyaltyDmgMul(w.id) : 1;
      SF.Projectiles.spawn(w.x, w.y, ang, 520, cdef.dps * 0.9 * mul,
        true, '#9fd8ff');
    }
  }

  /* Formation steering post-pass: nudge non-delta wingmen toward their
   * formation anchor. Delta == the base AI anchor, so it is skipped and
   * the pass can never fight the base AI. */
  function formationPass(dt) {
    if (!window.SF || !SF.Player || !SF.Player.alive) return;
    if (!SF.Game || SF.Game.state !== 'PLAYING') return;
    var act = activeWingmen();
    var p = SF.Player;
    /* Rate 14/s: strong enough to hold the formation anchor against the
     * base AI's competing pull toward the delta anchor (clamp(d*4,60,420)
     * px/s). Fractional blend, so no overshoot/oscillation. */
    var k = Math.min(1, 14 * dt);
    for (var i = 0; i < act.length; i++) {
      var w = act[i];
      if (get(w).id === DEFAULT_ID) continue;
      /* wingman-tactics: hold-order wingmen ignore formation steering —
       * the orders pass pins them to their hold point instead. */
      if (window.SF && SF.WingmanOrders && SF.WingmanOrders.orderId(w) === 'hold') continue;
      var a = anchorFor(w, i, p.x, p.y, p.angle);
      w.x += (a.x - w.x) * k;
      w.y += (a.y - w.y) * k;
    }
  }

  /* ---- formation selector widget (canvas-drawn, tap to cycle) ---- */
  var slotRects = [];
  function drawFormationWidget(ctx) {
    slotRects = [];
    if (!window.SF || !SF.Player) return;
    var c = document.getElementById('game');
    if (!c) return;
    var rect = c.getBoundingClientRect();
    var W = rect.width;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var act = activeWingmen();
    // formation row, centered. (The reactor widget used to stack above
    // this at tabs 64-84 / heat 88-95; it moved to the top-right on
    // 2026-10-23, so this row now owns the center slot alone.)
    // No idle text — nothing drawn with no wingmen
    var y = 106, ch = 26;
    if (!act.length) { ctx.restore(); return; }
    var cw = 74, gap = 6;
    var totalW = act.length * cw + (act.length - 1) * gap;
    var x0 = Math.round((W - totalW) / 2);
    ctx.font = '11px system-ui, sans-serif';
    for (var i = 0; i < act.length; i++) {
      var w = act[i], def = get(w);
      var x = x0 + i * (cw + gap);
      ctx.fillStyle = 'rgba(8,12,24,0.72)';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = def.color; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      /* wingman-tactics: order tag (ATK/GRD/HLD) beside the formation short,
       * drawn in the order's own color. */
      var WO = (window.SF && SF.WingmanOrders) ? SF.WingmanOrders : null;
      var odef = WO ? WO.get(w) : null;
      var main = 'W' + (i + 1) + ' ' + def.short;
      var otag = odef ? ' ' + odef.short : '';
      var wm = ctx.measureText(main).width;
      var wt = ctx.measureText(otag).width;
      var sx = x + (cw - wm - wt) / 2;
      var prevAlign = ctx.textAlign;
      ctx.textAlign = 'left';
      ctx.fillStyle = def.color;
      ctx.fillText(main, sx, y + ch / 2 + 1);
      if (odef) {
        ctx.fillStyle = odef.color;
        ctx.fillText(otag, sx + wm, y + ch / 2 + 1);
      }
      ctx.textAlign = prevAlign;
      slotRects.push({ x: x, y: y, w: cw, h: ch, slot: i });
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#9db0cc';
    ctx.fillText('tap chip: formation \u00B7 hold 350ms: order (ATK/GRD/HLD)',
      W / 2, y + ch + 12);
    ctx.restore();
  }

  var API = {
    defs: function () { return SF.WINGMAN_FORMATIONS.slice(); },
    defOf: function (id) { return BY_ID[validId(id) ? id : DEFAULT_ID]; },
    validId: validId,
    get: get,
    anchorFor: anchorFor,
    /* Combat multipliers for a wingman record (defensive). */
    dmgDealtMul: function (w) { return get(w).dmgDealtMul; },
    hitTakenMul: function (w) { return get(w).hitTakenMul; },
    dmgTakenMul: function (w) { return get(w).dmgTakenMul; },
    sensorMul: function (w) { return get(w).sensorMul; },
    engagementRange: function (w) {
      return SF.WINGMAN_BASE_ENGAGE * get(w).sensorMul;
    },
    /* Assign a formation to an ACTIVE wingman slot (0-based). */
    setFormation: function (slotIdx, id) {
      if (!validId(id)) return false;
      var act = activeWingmen();
      if (slotIdx < 0 || slotIdx >= act.length) return false;
      act[slotIdx].formation = id;
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui(); // sfx-hooks-v34b-retry: formation change
      return true;
    },
    cycleFormation: function (slotIdx) {
      var act = activeWingmen();
      if (slotIdx < 0 || slotIdx >= act.length) return null;
      var w = act[slotIdx];
      var cur = get(w).id;
      var ids = SF.WINGMAN_FORMATIONS.map(function (f) { return f.id; });
      var next = ids[(ids.indexOf(cur) + 1) % ids.length];
      w.formation = next;
      var def = BY_ID[next];
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('✈ W' + (slotIdx + 1) + ' → ' + def.name + ': ' + def.hint);
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      return next;
    },
    formationPass: formationPass,
    sensorPass: sensorPass,
    drawFormationWidget: drawFormationWidget,
    widgetRects: function () { return slotRects.slice(); },
    hitTest: function (cx, cy) {
      for (var i = 0; i < slotRects.length; i++) {
        var r = slotRects[i];
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.slot;
      }
      return -1;
    }
  };
  SF.WingmanFormations = API;

  /* ---- deferred additive wraps (quests.js/npcs.js load after ship.js) ---- */
  (function installWraps(tries) {
    tries = tries || 0;
    var C = window.SF && SF.Companions;
    if (C && C.update && C.loyaltyDmgMul && C.toggleActive) {
      if (!C.update.__wmf) {
        var ou = C.update;
        var wu = function (dt) {
          try { sensorPass(); } catch (e) { /* never break the AI */ }
          var r = ou.call(this, dt);
          try { formationPass(dt); } catch (e) { /* never break the AI */ }
          /* wingman-tactics: tactical orders post-pass (attack/guard/hold). */
          try { if (window.SF && SF.WingmanOrders) SF.WingmanOrders.ordersPass(dt); }
          catch (e) { /* never break the AI */ }
          return r;
        };
        wu.__wmf = true;
        C.update = wu;
      }
      if (!C.loyaltyDmgMul.__wmf) {
        var ol = C.loyaltyDmgMul;
        var wl = function (id) {
          var base = ol.call(this, id) || 1;
          /* formation dmg dealt: look up the ACTIVE wingman record by id.
           * Not active (hire UI previews etc.) -> no formation applies. */
          var mult = 1;
          try {
            var act = activeWingmen();
            for (var i = 0; i < act.length; i++) {
              if (act[i].id === id) { mult = get(act[i]).dmgDealtMul; break; }
            }
          } catch (e) {}
          return base * mult;
        };
        wl.__wmf = true;
        C.loyaltyDmgMul = wl;
      }
      /* Stamp every active record with a valid formation id. Needed because
       * hire() auto-activates by pushing {id,x,y} directly (no toggleActive),
       * and older saves carry records without the key.
       * wingman-tactics: also stamp the tactical order (default 'attack',
       * runtime-only; unknown/missing ids read as 'attack'). */
      function defaultRecords() {
        try {
          var act = activeWingmen();
          for (var i = 0; i < act.length; i++) {
            if (!validId(act[i].formation)) act[i].formation = DEFAULT_ID;
            if (window.SF && SF.WingmanOrders &&
                !SF.WingmanOrders.validId(act[i].order)) act[i].order = 'attack';
          }
        } catch (e) {}
      }
      if (!C.hire.__wmf) {
        var oh = C.hire;
        var wh = function (id) {
          var r = oh.apply(this, arguments);
          defaultRecords();
          return r;
        };
        wh.__wmf = true;
        C.hire = wh;
      }
      if (!C.toggleActive.__wmf) {
        var ot = C.toggleActive;
        var wt = function (id) {
          var r = ot.apply(this, arguments);
          defaultRecords();
          return r;
        };
        wt.__wmf = true;
        C.toggleActive = wt;
      }
      defaultRecords();
      return; /* installed */
    }
    if (tries < 240) setTimeout(function () { installWraps(tries + 1); }, 500);
  })();
})();

/* ============================================================
 * wingman-tactics phase: per-wingman tactical ORDERS.
 *
 * Attack (ATK, default) — focus the player's locked target: a gentle
 *   steering pull toward SF.TargetLock.current() when it is live and
 *   within 1400px of the wingman (the quests.js base AI handles firing).
 * Guard (GRD) — tight escort: steering pull toward a close anchor
 *   (back 44 / side 30), plus point-defense: hostile projectiles that
 *   reach the wingman (60px envelope) are shot down with a spark pop.
 *   Guard wingmen fly tight, so missiles aimed at the player pass
 *   through their envelope. Drones stay entities — the untouched base
 *   AI fire line engages them.
 * Hold (HLD) — hold position: strong pull back to the captured hold
 *   point; base AI firing is untouched (weapons free in range).
 *
 * Purely additive: implemented as SF.WingmanOrders + an ordersPass(dt)
 * post-pass chained after formationPass in the SF.Companions.update
 * wrap above. The quests.js base AI is NOT edited.
 *
 * Save-neutral: order lives additively on the wingman record
 * ({id, x, y, formation, order}); the whole companions blob is
 * deep-copied by serialize(), so it persists with NO SF.SAVE_VERSION
 * bump. Unknown/missing order ids read as 'attack'. _holdPos and
 * _pdCool are runtime-only.
 * ============================================================ */
SF.WINGMAN_ORDERS = [
  { id: 'attack', name: 'Attack', short: 'ATK', color: '#ff8c2e',
    hint: 'Focus the player\u2019s locked target.' },
  { id: 'guard', name: 'Guard', short: 'GRD', color: '#57d98a',
    hint: 'Tight escort. Point-defense vs missiles near you.' },
  { id: 'hold', name: 'Hold', short: 'HLD', color: '#9fd8ff',
    hint: 'Hold position. Weapons free in range.' }
];

(function () {
  'use strict';
  var SF = window.SF = window.SF || {};

  var BY_ID = {};
  SF.WINGMAN_ORDERS.forEach(function (f) { BY_ID[f.id] = f; });
  var DEFAULT_ID = 'attack';
  var GUARD_ANCHOR = { back: 44, side: 30 };
  var PD_RANGE = 60;      /* point-defense intercept radius (px) */
  var PD_COOL = 0.25;     /* per-wingman intercept cooldown (s) */
  var FOCUS_RANGE = 1400; /* attack steering pull range */
  var LONGPRESS_MS = 350;

  function validId(id) { return !!(id && BY_ID[id]); }
  function get(w) {
    var id = (w && validId(w.order)) ? w.order : DEFAULT_ID;
    return BY_ID[id];
  }
  function activeWingmen() {
    if (!window.SF || !SF.Companions || !SF.Companions.active) return [];
    try { return SF.Companions.active() || []; } catch (e) { return []; }
  }

  function orderSfx(id) {
    try {
      if (SF.Audio && SF.Audio.sfx) {
        SF.Audio.sfx(id === 'hold' ? 'wingman_order_hold'
          : 'wingman_order_ack' + (1 + Math.floor(Math.random() * 3)));
      } else if (SF.Audio && SF.Audio.ui) { SF.Audio.ui(); }
    } catch (e) {}
  }

  /* Guard anchor — same formula as the formation anchor. */
  function guardAnchor(idx, px, py, angle) {
    var side = GUARD_ANCHOR.side * (idx === 0 ? -1 : 1);
    return {
      x: px - Math.cos(angle) * GUARD_ANCHOR.back - Math.sin(angle) * side,
      y: py - Math.sin(angle) * GUARD_ANCHOR.back + Math.cos(angle) * side
    };
  }

  /* Guard point-defense: hostile projectiles that reach the wingman are
   * shot down (deactivated with a spark pop, no blast damage). */
  function pointDefense(w, dt) {
    w._pdCool = Math.max(0, (w._pdCool || 0) - dt);
    if (w._pdCool > 0) return;
    if (!SF.Projectiles || !SF.Projectiles.pool) return;
    var pool = SF.Projectiles.pool;
    for (var i = 0; i < pool.length; i++) {
      var pr = pool[i];
      if (!pr || !pr.active || pr.friendly) continue;
      if (Math.hypot(pr.x - w.x, pr.y - w.y) > PD_RANGE) continue;
      pr.active = false;
      w._pdCool = PD_COOL;
      try {
        if (SF.Particles && SF.Particles.explosion)
          SF.Particles.explosion(pr.x, pr.y, 0.22, false);
        if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('hit');
      } catch (e) {}
      break; /* one intercept per pass */
    }
  }

  /* The orders post-pass: runs after the base AI + formation pass. */
  function ordersPass(dt) {
    if (!window.SF || !SF.Player || !SF.Player.alive) return;
    if (!SF.Game || SF.Game.state !== 'PLAYING') return;
    var act = activeWingmen();
    if (!act.length) return;
    var p = SF.Player;
    var lockT = null;
    try {
      if (SF.TargetLock && typeof SF.TargetLock.current === 'function')
        lockT = SF.TargetLock.current();
    } catch (e) {}
    if (lockT && (lockT.dead || lockT.hp <= 0)) lockT = null;
    for (var i = 0; i < act.length; i++) {
      var w = act[i];
      var oid = get(w).id;
      if (oid === 'guard') {
        /* tight escort steering (wins over the looser base anchor);
         * exponential blend is frame-rate independent */
        var a = guardAnchor(i, p.x, p.y, p.angle);
        var k = 1 - Math.exp(-16 * dt);
        w.x += (a.x - w.x) * k;
        w.y += (a.y - w.y) * k;
        pointDefense(w, dt);
        /* firing: untouched base AI (nearest enemy), now from escort range */
      } else if (oid === 'hold') {
        if (!w._holdPos) w._holdPos = { x: w.x, y: w.y };
        var hk = 1 - Math.exp(-30 * dt);
        w.x += (w._holdPos.x - w.x) * hk;
        w.y += (w._holdPos.y - w.y) * hk;
        /* weapons free: the base AI fire line is untouched */
      } else { /* attack: focus the player's locked target */
        if (lockT) {
          var d = Math.hypot(lockT.x - w.x, lockT.y - w.y);
          if (d > SF.WINGMAN_BASE_ENGAGE && d < FOCUS_RANGE) {
            var ak = 1 - Math.exp(-6 * dt);
            w.x += (lockT.x - w.x) * ak;
            w.y += (lockT.y - w.y) * ak;
          }
        }
      }
    }
  }

  var API = {
    defs: function () { return SF.WINGMAN_ORDERS.slice(); },
    defOf: function (id) { return BY_ID[validId(id) ? id : DEFAULT_ID]; },
    validId: validId,
    get: get,
    orderId: function (w) { return get(w).id; },
    LONGPRESS_MS: LONGPRESS_MS,
    setOrder: function (slotIdx, id) {
      if (!validId(id)) return false;
      var act = activeWingmen();
      if (slotIdx < 0 || slotIdx >= act.length) return false;
      var w = act[slotIdx];
      w.order = id;
      w._holdPos = null; /* re-captured by the pass */
      orderSfx(id);
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('✈ W' + (slotIdx + 1) + ' order: ' + BY_ID[id].name +
          ' — ' + BY_ID[id].hint);
      return true;
    },
    cycleOrder: function (slotIdx) {
      var act = activeWingmen();
      if (slotIdx < 0 || slotIdx >= act.length) return null;
      var ids = SF.WINGMAN_ORDERS.map(function (f) { return f.id; });
      var cur = get(act[slotIdx]).id;
      var next = ids[(ids.indexOf(cur) + 1) % ids.length];
      API.setOrder(slotIdx, next);
      return next;
    },
    ordersPass: ordersPass
  };
  SF.WingmanOrders = API;
})();

/* wingman-tactics: formation widget tap/hold (capture phase, before the
 * twin-stick joystick handlers in input.js). Desktop: plain mouse.
 * Short press (<350ms) cycles formation; hold (>=350ms) cycles the
 * tactical order (ATK/GRD/HLD). */
(function () {
  function playing() {
    return window.SF && SF.Game && SF.Game.state === 'PLAYING';
  }
  function longMs() {
    return (window.SF && SF.WingmanOrders) ? SF.WingmanOrders.LONGPRESS_MS : 350;
  }
  var press = null; /* {slot, timer, fired, touchId} */
  function beginPress(cx, cy, touchId) {
    if (!playing() || !window.SF || !SF.WingmanFormations) return false;
    if (press) return false;
    var slot = SF.WingmanFormations.hitTest(cx, cy);
    if (slot < 0) return false;
    press = { slot: slot, touchId: touchId, fired: false, timer: 0 };
    press.timer = setTimeout(function () {
      if (press && !press.fired) {
        press.fired = true;
        if (window.SF && SF.WingmanOrders) SF.WingmanOrders.cycleOrder(press.slot);
      }
    }, longMs());
    return true;
  }
  function endPress(touchId) {
    if (!press) return false;
    if (touchId !== undefined && press.touchId !== touchId) return false;
    clearTimeout(press.timer);
    var p = press; press = null;
    if (!p.fired && window.SF && SF.WingmanFormations)
      SF.WingmanFormations.cycleFormation(p.slot);
    return true;
  }
  var lastTapT = 0;
  window.addEventListener('touchstart', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (beginPress(t.clientX, t.clientY, t.identifier)) {
        lastTapT = Date.now();
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }
    }
  }, { capture: true, passive: false });
  function touchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (endPress(t.identifier) && e.cancelable) e.preventDefault();
    }
  }
  window.addEventListener('touchend', touchEnd, { capture: true, passive: false });
  window.addEventListener('touchcancel', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++)
      endPress(e.changedTouches[i].identifier);
    press = null;
  }, { capture: true, passive: true });
  window.addEventListener('mousedown', function (e) {
    if (Date.now() - lastTapT < 600) return;
    beginPress(e.clientX, e.clientY, 'mouse');
  });
  window.addEventListener('mouseup', function () { endPress('mouse'); });
})();

/* ============================================================
 * subsystem-damage-repair phase (2026-10-21): in-flight subsystem
 * damage model, session-scoped.
 *
 * P.subsys = {engines,weapons,shields,sensors,life}, each 0-100.
 * Session-scoped: initialized in SF.Player.create(), NEVER serialized,
 * NO SF.SAVE_VERSION bump. Resets to 100% on new game AND on load
 * (deserialize() calls create() first, then overwrites saved fields).
 *
 * Damage: hull-through hits (the part of a hit that gets past shields)
 * deal SF.SUBSYS_DMG_FRAC of their damage to subsystems, weighted by
 * impact location relative to the ship's nose:
 *   rear hit      -> engines take the brunt
 *   head-on hit   -> weapons + sensors
 *   broadside hit -> shields + life-support
 * Source resolution mirrors hud.js sourceAngle (the takeDamage wrap chain
 * in hud.js/gameplay.js/main.js forwards only (dmg), so live hits resolve
 * by inference): explicit srcX/srcY on direct API calls, else the nearest
 * hostile projectile (recently-deactivated ones within 80u count, since
 * main.js deactivates the projectile just before takeDamage()), else the
 * nearest live enemy, else uniform weights.
 *
 * Effects (all kick in below 50% integrity):
 *   engines  -> thrust/top-speed penalty (engineSpeedMul: 1 -> 0.5)
 *   weapons  -> fire-rate penalty (weaponRateMul: 1 -> 0.6) + weapon
 *               heat builds up to 5x faster below 50% integrity; at 100
 *               heat a 3s forced vent locks the guns (a healthy ship's
 *               passive cooling outpaces normal buildup, so overheat only
 *               bites when the weapons subsystem is hurt)
 *   shields  -> recharge delay lengthened (shieldDelayMul: 1 -> 3x)
 *   sensors  -> target-lock range + seeker acquisition shrink
 *               (sensorRangeMul: 1 -> 0.4); starmap fog-of-war wiring is a
 *               declared follow-up (starmap.js is outside this phase's
 *               scope) — sensorRangeMul()/subsystemIntegrity('sensors')
 *               are the API it should consume
 *   life     -> crew morale drains 2/s + HUD warning flash
 *
 * Repairs: station dock SERVICES section (station.js, in scope) sells a
 * full subsystem repair scaled to total missing integrity; nano-paste is
 * a craftable field consumable (R key in flight, +20 all subsystems)
 * registered additively on SF.RECIPES/SF.ITEM_BY_ID with a 'consumable'
 * output kind handled by a craft() wrap — the existing workbench hooks.
 * ============================================================ */
SF.SUBSYSTEMS = [
  { id: 'engines', name: 'Engines',      icon: '🔧', color: '#ff9d2e',
    hint: 'thrust and top speed reduced.' },
  { id: 'weapons', name: 'Weapons',      icon: '🎯', color: '#ff5e3a',
    hint: 'fire rate reduced, guns overheat faster.' },
  { id: 'shields', name: 'Shields',      icon: '🛡', color: '#3fa9ff',
    hint: 'shield recharge delayed.' },
  { id: 'sensors', name: 'Sensors',      icon: '📡', color: '#b78cff',
    hint: 'target-lock range + seeker acquisition reduced.' },
  { id: 'life',    name: 'Life Support', icon: '💚', color: '#3ddc5f',
    hint: 'crew morale draining — repair soon.' }
];
SF.SUBSYS_DMG_FRAC = 0.25;    // fraction of hull-through damage dealt to subsystems
SF.SUBSYS_REPAIR_PER_PT = 3;  // credits per missing integrity point at a station
SF.NANO_PASTE_RESTORE = 20;   // integrity points restored per subsystem per paste
SF.WEAP_HEAT_PER_SHOT = 4;    // weapon heat per shot (x weaponHeatMul when damaged)
SF.WEAP_HEAT_COOL = 25;       // weapon heat cooled per second when not firing
SF.WEAP_VENT_TIME = 3;        // forced gun lockout at max heat (seconds)
SF.LIFESUP_MORALE_DRAIN = 2;  // crew morale drained per second at life-support <50%
SF.TARGET_LOCK_RANGE = 2500;  // mirrors hud.js SF.TargetLock LOCK_RANGE (read-only copy)

/* nano-paste: craftable field-repair consumable.
 * Registered additively once SF.Crafting exists (deferred init, idempotent).
 * Uses the existing workbench hooks: SF.RECIPES (rendered by
 * renderWorkbench), canCraft/costText, and craft() (wrapped for the
 * 'consumable' output kind -> player inventory). Also registers the
 * SF.ITEM_BY_ID entry so the station sell-components row can price it
 * instead of crashing on an unknown id. */
SF.NANO_PASTE_ID = 'nano_paste';
SF.NANO_PASTE_RECIPE_ID = 'r_nano_paste';
(function installNanoPaste(tries) {
  tries = tries || 0;
  var ok = window.SF && SF.Crafting && SF.RECIPES && SF.ITEMS && SF.ITEM_BY_ID;
  if (ok) {
    try {
      if (!SF.ITEM_BY_ID[SF.NANO_PASTE_ID]) {
        var item = { id: SF.NANO_PASTE_ID, name: 'Nano-Paste', tier: 'green',
          kind: 'consumable', price: 250,
          desc: 'Field repair consumable. Press R in flight: +20% all subsystems.' };
        SF.ITEMS.push(item);
        SF.ITEM_BY_ID[item.id] = item;
      }
      var found = null;
      for (var i = 0; i < SF.RECIPES.length; i++) {
        if (SF.RECIPES[i].id === SF.NANO_PASTE_RECIPE_ID) { found = SF.RECIPES[i]; break; }
      }
      if (!found) {
        SF.RECIPES.push({ id: SF.NANO_PASTE_RECIPE_ID, name: 'Nano-Paste', tier: 'green',
          desc: 'Field repair consumable. Press R in flight to patch all subsystems +20 integrity.',
          cost: { credits: 600, ore: 5 },
          output: { kind: 'consumable', id: SF.NANO_PASTE_ID, n: 1 } });
      }
      /* crafting.js builds its BY_ID recipe map once at load, so a recipe
       * pushed later is invisible to recipe()/canCraft() — wrap both,
       * mirroring the salvage-drones addon convention. renderWorkbench
       * iterates SF.RECIPES directly, so it needs no wrap. */
      function nanoRecipe() {
        for (var i = 0; i < SF.RECIPES.length; i++) {
          if (SF.RECIPES[i].id === SF.NANO_PASTE_RECIPE_ID) return SF.RECIPES[i];
        }
        return null;
      }
      function fmtN(n) { return Math.floor(n).toLocaleString('en-US'); }
      function nanoCanCraft() {
        var r = nanoRecipe();
        if (!r) return { ok: false, missing: ['unknown recipe'] };
        var p = SF.Player, miss = [];
        if (p.credits < r.cost.credits) miss.push(fmtN(r.cost.credits - p.credits) + 'c short');
        if (p.ore < r.cost.ore) miss.push(fmtN(r.cost.ore - p.ore) + ' ore short');
        (r.cost.parts || []).forEach(function (cc) {
          var have = (p.partInventory || {})[cc.id] || 0;
          if (have < cc.n) miss.push(cc.id + ' ' + have + '/' + cc.n);
        });
        (r.cost.items || []).forEach(function (cc) {
          var have2 = (p.inventory || {})[cc.id] || 0;
          if (have2 < cc.n) miss.push(cc.id + ' ' + have2 + '/' + cc.n);
        });
        var lock = null;
        try { lock = SF.Crafting.lockInfo(r); } catch (e) {}
        if (lock) miss.push(lock);
        return { ok: miss.length === 0, missing: miss };
      }
      if (!SF.Crafting.recipe.__nanopaste) {
        var origRecipe = SF.Crafting.recipe;
        var wr = function (id) {
          if (id === SF.NANO_PASTE_RECIPE_ID) return nanoRecipe();
          return origRecipe.call(this, id);
        };
        wr.__nanopaste = true;
        SF.Crafting.recipe = wr;
      }
      if (!SF.Crafting.canCraft.__nanopaste) {
        var origCanCraft = SF.Crafting.canCraft;
        var wc2 = function (id) {
          if (id === SF.NANO_PASTE_RECIPE_ID) return nanoCanCraft();
          return origCanCraft.call(this, id);
        };
        wc2.__nanopaste = true;
        SF.Crafting.canCraft = wc2;
      }
      if (!SF.Crafting.craft.__nanopaste) {
        var origCraft = SF.Crafting.craft;
        var wc = function (id) {
          var r = null;
          try { r = SF.Crafting.recipe(id); } catch (e) {}
          if (r && r.output && r.output.kind === 'consumable') {
            var chk = this.canCraft(id);
            if (!chk.ok) return false;
            var p = SF.Player;
            p.credits -= r.cost.credits;
            p.ore -= r.cost.ore;
            (r.cost.parts || []).forEach(function (cc) {
              p.partInventory[cc.id] = (p.partInventory[cc.id] || 0) - cc.n;
            });
            (r.cost.items || []).forEach(function (cc) {
              p.inventory[cc.id] = (p.inventory[cc.id] || 0) - cc.n;
            });
            p.inventory[r.output.id] = (p.inventory[r.output.id] || 0) + (r.output.n || 1);
            if (SF.Audio && SF.Audio.craft) SF.Audio.craft();
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('⚒ Crafted: ' + r.name);
            return true;
          }
          return origCraft.call(this, id);
        };
        wc.__nanopaste = true;
        SF.Crafting.craft = wc;
      }
    } catch (e) { /* never break boot on a consumable registration */ }
    return;
  }
  if (tries < 240) setTimeout(function () { installNanoPaste(tries + 1); }, 500);
})();

SF.Player = (function () {
  var P = null;

  /* twelve-hour-wave2: weapon FEEL tables (visual/audio only — no damage,
   * rate, range, or any balance number lives here). Muzzle flash diameter
   * and recoil kick (px of brief rearward ship offset) per projectile
   * kind; kinds already distinct in the projectile paint path get their
   * own flash/kick so fire reads differently per family at phone size.
   * Defaults: bolt 38px / 1.5px. */
  var FEEL_MUZZLE = { bolt: 38, pellet: 30, slug: 54, orb: 40, beam: 48,
    missile: 46, mine: 40, emp: 44, starfall: 52 };
  var FEEL_KICK = { bolt: 1.5, pellet: 2, slug: 5, orb: 2, beam: 2.5,
    missile: 4, mine: 1, emp: 3, starfall: 3 };
  function muzzleSizeFor(kind) { return FEEL_MUZZLE[kind] || 38; }
  function kickFor(kind) { return FEEL_KICK[kind] || 1.5; }

  /* beta-aim: close-range drag-aim snap (aim ASSIST, not auto-aim).
   * Measured problem (probe.mjs, pre-fix): a player drag-aiming roughly at
   * a close-sticking drone still misses — at glue range the bearing spins
   * faster than a thumb can track, and the drone's weave (±~34px lateral)
   * dodges untracked shots. The snap ONLY fires when the player is
   * already drag-aiming (turret mount + aim stick active) AND the nearest
   * hostile is inside AIM_SNAP_RANGE and within AIM_SNAP_CONE of the
   * stick direction; it then fires at the lead-predicted intercept
   * (enemy pos + velocity * flight time) instead of the raw stick angle.
   * FIRE-button forward fire is untouched (still exactly P.angle), and no
   * damage, rate, speed, HP, or projectile-life number changes: this only
   * picks a fire direction the player already chose within 28.6 degrees.
   * Runtime-only debug: this._aimSnap on the facade (never serialized). */
  var AIM_SNAP_RANGE = 350, AIM_SNAP_CONE = 0.5; // px, rad (~28.6 deg)
  function angDiffSnap(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function snapTargetFor(px, py, aimAngle) {
    var list = null;
    try { list = (window.SF && SF.Enemies) ? SF.Enemies.list : null; } catch (e) {}
    if (typeof list === 'function') { try { list = list(); } catch (e2) { list = null; } }
    if (!list || !list.length) return null;
    var best = null, bd = AIM_SNAP_RANGE + 1;
    for (var i = 0; i < list.length; i++) {
      var se = list[i];
      if (!se || se.dead || se.trader || se.adrift) continue;
      /* neutral-stance patrols are not snap targets until provoked —
       * same hostility rule as SF.TargetLock, minus the lock button. */
      if (se.faction && !se.playerAggro) {
        try {
          if (window.SF && SF.Factions && typeof SF.Factions.stance === 'function' &&
              SF.Factions.stance(se.faction) !== 'hostile') continue;
        } catch (e3) { /* stance unreadable: treat as hostile, as before */ }
      }
      var dx = se.x - px, dy = se.y - py;
      var d = Math.hypot(dx, dy);
      if (d > AIM_SNAP_RANGE || d >= bd) continue;
      if (Math.abs(angDiffSnap(Math.atan2(dy, dx), aimAngle)) > AIM_SNAP_CONE) continue;
      best = se; bd = d;
    }
    return best ? { e: best, dist: bd } : null;
  }

  function activeShip() { return P.ships[P.activeShip]; }
  function activeClass() { return SF.SHIP_CLASS_BY_ID[activeShip().classId]; }
  function buildStats() { return SF.Parts.derive(activeShip().classId, activeShip().parts); }

  function effectiveSpeed() {
    var s = buildStats().speed * setMul('speed') * profMul('speed'); // power-profiles
    if (P.upgrades.engine) s *= SF.CONFIG.economy.engineSpeedMul; // Phase 1 legacy tuning
    /* twelve-hour-wave3 (B2): Piloting speed — the skill multiplier rides
     * the single top-speed seam, so SF.Player.speed() inherits it too. */
    return s * engineSpeedMul() * skillMul('speedMul'); // subsystem-damage-repair: damaged engines cut thrust/top speed
  }
  function maxHull() { return buildStats().hull; }
  function maxShield() {
    /* twelve-hour-wave3 (B2): Engineering max shield now applies INSIDE
     * the private seam (the old skills.js facade wrap on SF.Player.maxShield
     * is removed — the facade delegates here, so keeping the wrap would
     * double-apply). Flat Phase-1 shield bonus cell stays unscaled. */
    var s = Math.round(buildStats().shield * setMul('shield') * skillMul('shieldMul'));
    if (P.upgrades.shield) s += SF.CONFIG.economy.shieldBonus; // Phase 1 legacy cell
    return s;
  }

  /* twelve-hour-wave3 (B2): skill-multiplier seam for ship.js internals.
   * skills.js loads after ship.js (via hud.js document.write), so every
   * read is guarded: missing skills = 1.0, never a throw. */
  function skillMul(name) {
    try {
      if (window.SF && SF.Skills && typeof SF.Skills[name] === 'function')
        return SF.Skills[name]();
    } catch (e) {}
    return 1;
  }

  /* ---- set-bonuses phase: manufacturer set bonuses ----
   * Purely computed from fitted parts; save-neutral (no new saved fields,
   * no save-version bump). setMul(stat) multiplies one combat stat:
   * 'dmg' | 'shield' | 'speed' | 'regen'. */
  function setBonusesFor(classId, fitted) {
    var counts = {};
    (fitted || []).forEach(function (fp) {
      var p = SF.PART_BY_ID[fp.partId];
      if (p && p.maker && SF.SET_LINES[p.maker]) {
        counts[p.maker] = (counts[p.maker] || 0) + 1;
      }
    });
    var out = [];
    Object.keys(SF.SET_LINES).forEach(function (lineId) {
      var n = counts[lineId] || 0;
      if (n < 2) return; // mixed / single parts grant nothing
      var line = SF.SET_LINES[lineId];
      var tier = n >= 4 ? 4 : (n >= 3 ? 3 : 2);
      var t = line.tiers[tier];
      out.push({ line: lineId, name: line.name, color: line.color, count: n,
                 stat: line.stat, mul: t.mul, tier: tier, text: t.text,
                 desc: line.desc });
    });
    return out;
  }
  function setMulFor(stat, classId, fitted) {
    var m = 1;
    setBonusesFor(classId, fitted).forEach(function (b) {
      if (b.stat === stat) m *= b.mul;
    });
    return m;
  }
  function setMul(stat) {
    var sh = activeShip();
    return setMulFor(stat, sh.classId, sh.parts);
  }
  /* DOM snippet for the ship-builder UI listing active set bonuses.
   * NOTE (set-bonuses phase): wiring this into builder.js renderStats() is a
   * declared follow-up — builder.js is outside this phase's file scope. */
  function setBonusBadgeHTML(classId, fitted) {
    var bonuses = setBonusesFor(classId, fitted);
    if (!bonuses.length) {
      return '<div class="dim">No set bonuses — fit 2+ parts from one manufacturer line.</div>';
    }
    var h = '<div class="setbonus-list">';
    bonuses.forEach(function (b) {
      h += '<div class="setbonus-row"><span class="setbonus-name" style="color:' + b.color +
        '">' + b.name + ' ' + b.count + 'pc</span><b>' + b.text + '</b></div>';
    });
    return h + '</div>';
  }
  function radius() {
    var cls = activeClass();
    return Math.round(10 + Math.max(cls.gridW, cls.gridH) * 1.4);
  }

  /* ---- power-profiles: reactor profile helpers (runtime-only) ---- */
  function profMul(stat) {
    if (!P || !P.reactor) return 1;
    var R = P.reactor;
    if (R.vent > 0) return 0.5; // forced vent: -50% all stats
    var def = SF.REACTOR_PROFILES[R.profile];
    return (def && def.mul[stat]) || 1;
  }

  function reactorTick(dt) {
    if (!P || !P.reactor) return; // guard: create() always sets it, but be safe
    var R = P.reactor;
    if (R.cooldown > 0) R.cooldown = Math.max(0, R.cooldown - dt);
    if (R.vent > 0) {
      R.vent -= dt;
      if (R.vent <= 0) {
        R.vent = 0; R.heat = 0; R.profile = 0; // vent ends: fall back to Balanced
        SF.HUD.toast('⚙ Reactor vented — Balanced profile restored.');
      }
      return;
    }
    if (R.profile === 3) { // Overdrive builds heat
      var wasHeat = R.heat; // sfx-hooks-v34b-retry: overdrive_heat edge
      R.heat += SF.REACTOR_HEAT_RATE * dt;
      if (wasHeat < 75 && R.heat >= 75 && SF.Audio && SF.Audio.alert) SF.Audio.alert(); // sfx-hooks-v34b-retry: overdrive_heat
      if (R.heat >= 100) {
        R.heat = 100; R.vent = SF.REACTOR_VENT_TIME;
        SF.HUD.toast('🔥 Reactor overheated! Forced 10s vent — stats halved.');
        if (SF.Audio && SF.Audio.hullAlarm) SF.Audio.hullAlarm();
      }
    } else if (R.heat > 0) {
      R.heat = Math.max(0, R.heat - SF.REACTOR_HEAT_COOL * dt);
    }
  }

  function cycleProfile() {
    if (!P || !P.reactor) return false;
    var R = P.reactor;
    if (R.vent > 0) { SF.HUD.toast('⚙ Reactor venting — profile locked.'); return false; }
    if (R.cooldown > 0) return false; // 3s switch cooldown
    R.profile = (R.profile + 1) % SF.REACTOR_PROFILES.length;
    R.cooldown = SF.REACTOR_SWITCH_COOLDOWN;
    var def = SF.REACTOR_PROFILES[R.profile];
    SF.HUD.toast('⚙ Reactor: ' + def.name + ' — ' + def.hint);
    SF.Audio.ui();
    /* stance-tabs-combat-gate: a stance switch IS a combat-relevant action.
     * Poke SF.CombatHUD (combat-context-hud) so combat mode — and with it
     * the stance tabs gated in drawReactorWidget — appears the moment the
     * stance is used, even when the switch came from the B key while the
     * tabs were hidden. Fully defensive: CombatHUD absent (older trees,
     * partial installs) = no-op, behavior exactly as before this phase. */
    try {
      if (window.SF && SF.CombatHUD && SF.CombatHUD.enter)
        SF.CombatHUD.enter('stance');
    } catch (e) { /* CombatHUD is advisory only; never break a switch */ }
    return true;
  }

  /* ---- subsystem-damage-repair: session-scoped subsystem integrity ----
   * P.subsys is initialized in create(), never serialized (no save bump).
   * subsys() is defensive: older in-memory sessions that predate this
   * phase get a fresh 100% state instead of a crash. */
  var SUBSYS_BY_ID = {};
  SF.SUBSYSTEMS.forEach(function (s) { SUBSYS_BY_ID[s.id] = s; });
  function freshSubsys() {
    return { engines: 100, weapons: 100, shields: 100, sensors: 100, life: 100 };
  }
  function subsys() {
    if (!P) return null;
    if (!P.subsys) P.subsys = freshSubsys();
    return P.subsys;
  }
  function clampSub(v) { return Math.max(0, Math.min(100, v)); }

  /* Penalty multipliers. Each is 1 at >=50% integrity and degrades
   * linearly to its floor at 0%. */
  function engineSpeedMul() {
    var s = subsys(); if (!s) return 1;
    var e = s.engines;
    return e >= 50 ? 1 : 0.5 + 0.5 * (e / 50);
  }
  function weaponRateMul() {
    var s = subsys(); if (!s) return 1;
    var w = s.weapons;
    return w >= 50 ? 1 : 0.6 + 0.4 * (w / 50);
  }
  /* Heat builds 1x at >=50% integrity, up to 5x at 0%: overheat only
   * bites when the weapons subsystem is actually hurt (a healthy ship's
   * passive cooling outpaces normal buildup). */
  function weaponHeatMul() {
    var s = subsys(); if (!s) return 1;
    var w = s.weapons;
    return w >= 50 ? 1 : 1 + 4 * (1 - w / 50);
  }
  function shieldDelayMul() {
    var s = subsys(); if (!s) return 1;
    var sh = s.shields;
    return sh >= 50 ? 1 : 1 + 2 * (1 - sh / 50);
  }
  function sensorRangeMul() {
    var s = subsys(); if (!s) return 1;
    var se = s.sensors;
    return se >= 50 ? 1 : 0.4 + 0.6 * (se / 50);
  }

  /* Impact-location weights for subsystem damage. The impact angle is
   * measured against the ship's nose: rear hits batter the engines,
   * head-on hits the weapons/sensors, broadsides the shields/life-support.
   * Source resolution (mirrors hud.js sourceAngle, which solved the same
   * problem for the damage-direction indicator):
   *   1. explicit srcX/srcY when the caller passes it through (direct API
   *      calls; the takeDamage wrap chain in hud.js/gameplay.js/main.js
   *      forwards only (dmg), so live hits use the inference below),
   *   2. nearest hostile projectile within 400 — main.js deactivates the
   *      projectile just before takeDamage(), so recently-deactivated
   *      hostile projectiles within 80 units count as the hit source,
   *   3. nearest live enemy within 400,
   *   4. uniform weights when nothing is found. */
  function impactAngle(srcX, srcY) {
    if (typeof srcX === 'number' && typeof srcY === 'number') {
      return Math.atan2(srcY - P.y, srcX - P.x) - P.angle;
    }
    var ang = null;
    try {
      var pool = (window.SF && SF.Projectiles && SF.Projectiles.pool) || [];
      var best = null, bd = 400 * 400, i, pr, dx, dy, d2;
      for (i = 0; i < pool.length; i++) {
        pr = pool[i];
        if (!pr || pr.friendly) continue;
        dx = pr.x - P.x; dy = pr.y - P.y; d2 = dx * dx + dy * dy;
        if (!pr.active && d2 > 80 * 80) continue; // stale wreck, not this hit
        if (d2 < bd) { bd = d2; best = pr; }
      }
      if (best) return Math.atan2(best.y - P.y, best.x - P.x) - P.angle;
    } catch (e) {}
    try {
      var l = (window.SF && SF.Enemies) ? SF.Enemies.list : null;
      if (typeof l === 'function') l = l();
      l = l || [];
      bd = 400 * 400; best = null;
      for (i = 0; i < l.length; i++) {
        var en = l[i];
        if (!en || en.dead) continue;
        dx = en.x - P.x; dy = en.y - P.y; d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = en; }
      }
      if (best) return Math.atan2(best.y - P.y, best.x - P.x) - P.angle;
    } catch (e2) {}
    return ang;
  }
  function impactWeights(srcX, srcY) {
    var w = { engines: 1, weapons: 1, shields: 1.2, sensors: 0.8, life: 0.6 };
    var ang = impactAngle(srcX, srcY);
    if (ang !== null) {
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      var a = Math.abs(ang);
      if (a > 2.35) { w.engines *= 2.2; }
      else if (a < 0.8) { w.weapons *= 2; w.sensors *= 1.6; }
      else { w.shields *= 1.6; w.life *= 1.4; }
    }
    return w;
  }

  function subsysCritical(id) {
    var def = SUBSYS_BY_ID[id];
    if (!def) return;
    try {
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast(def.icon + ' ' + def.name.toUpperCase() + ' CRITICAL — ' + def.hint);
      if (SF.Audio && SF.Audio.alert) SF.Audio.alert();
    } catch (e) {}
  }

  /* Distribute `total` subsystem damage across the five subsystems by
   * impact-location weight. Returns the integrity actually removed.
   * Fires a critical toast + alert the first time a subsystem crosses 50%. */
  function damageSubsystems(total, srcX, srcY) {
    var s = subsys();
    if (!s || !(total > 0)) return 0;
    var w = impactWeights(srcX, srcY);
    var sum = 0, k;
    for (k in w) sum += w[k];
    var dealt = 0;
    for (k in w) {
      var before = s[k];
      s[k] = clampSub(before - total * w[k] / sum);
      dealt += before - s[k];
      if (before >= 50 && s[k] < 50) subsysCritical(k);
    }
    return dealt;
  }

  /* Throttled damage-numbers feed entry for subsystem hits (reuses the
   * existing SF.FX.damageNumber pool; purple so it reads as system damage). */
  function subsysFeed(amount) {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - (P._feedT || 0) < 400) return;
    P._feedT = now;
    try {
      if (window.SF && SF.FX && SF.FX.damageNumber)
        SF.FX.damageNumber(P.x, P.y, amount, { type: 'taken', color: '#b78cff' });
    } catch (e) {}
  }

  /* Per-frame subsystem tick: weapon heat/vent, life-support morale drain
   * + warning flash, sensor target-lock clamp. Runs in update() before the
   * adrift branch so it also ticks while adrift. */
  function subsysTick(dt) {
    var s = subsys();
    if (!s) return;
    if ((P.weapVent || 0) > 0) {
      P.weapVent = Math.max(0, P.weapVent - dt);
      if (P.weapVent === 0) {
        P.weapHeat = 0;
        try {
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('🎯 Weapons cooled — fire at will.');
        } catch (e) {}
      }
    } else if ((P.weapHeat || 0) > 0) {
      P.weapHeat = Math.max(0, P.weapHeat - SF.WEAP_HEAT_COOL * dt);
    }
    if (s.life < 50) {
      /* life-support failing: crew morale drains; the crew.js morale field
       * contract (numeric 0-100, ensure() normalizes) is read defensively. */
      try {
        var crew = (activeShip() && activeShip().crew) || [];
        for (var i = 0; i < crew.length; i++) {
          var m = crew[i];
          if (m && typeof m.morale === 'number' && isFinite(m.morale))
            m.morale = Math.max(0, m.morale - SF.LIFESUP_MORALE_DRAIN * dt);
        }
      } catch (e) {}
      P._lsWarnT = (P._lsWarnT || 0) - dt;
      if (P._lsWarnT <= 0) {
        P._lsWarnT = 3;
        try { if (SF.HUD && SF.HUD.damageFlash) SF.HUD.damageFlash(); } catch (e) {}
      }
    } else {
      P._lsWarnT = 0;
    }
    /* sensors degraded: clamp the target lock to the shrunken range.
     * Additive over hud.js SF.TargetLock (LOCK_RANGE is a closure there,
     * so the clamp drops locks that exceed the degraded range instead of
     * editing the lock logic). */
    try {
      if (s.sensors < 50 && window.SF && SF.TargetLock &&
          typeof SF.TargetLock.current === 'function') {
        var lock = SF.TargetLock.current();
        if (lock && !lock.dead) {
          var effR = SF.TARGET_LOCK_RANGE * sensorRangeMul();
          var d = Math.hypot(lock.x - P.x, lock.y - P.y);
          if (d > effR && typeof SF.TargetLock.clear === 'function') {
            SF.TargetLock.clear();
            var now2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (now2 - (P._lockClampToast || 0) > 4000) {
              P._lockClampToast = now2;
              if (SF.HUD && SF.HUD.toast)
                SF.HUD.toast('📡 Sensors degraded — lock range ' + Math.round(effR) + 'm');
            }
          }
        }
      }
    } catch (e) {}
  }

  /* subsystem integrity cluster: 5 mini-bars under the DOM hull/shield
   * bars. Canvas-drawn (ship.js scope); critical subsystems blink a red
   * border. The y origin is measured from the live DOM (#bars, #weapon-btn)
   * so the cluster always sits below the left-column HUD chrome, cached
   * for 500ms to avoid per-frame layout reads. */
  var subsysYCache = { y: 58, t: 0 };
  function subsysClusterY() {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - subsysYCache.t < 500) return subsysYCache.y;
    subsysYCache.t = now;
    var y = 58;
    try {
      var W = window.innerWidth || 1280;
      ['bars', 'btn-menu', 'weapon-btn'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (r.x > W / 2) return; // left column only
        if (r.bottom > y - 8) y = Math.round(r.bottom) + 8;
      });
    } catch (e) {}
    subsysYCache.y = y;
    return y;
  }
  /* hud-declutter-2 (2026-10-22): the cluster used to paint all five
   * bars at full width even on a pristine ship — a rainbow slab of pure
   * noise that collided with the cooldown-pip row (hud-declutter-1 now
   * reserves this zone via SF.CooldownPips.subsysZone()). New rule:
   * all subsystems at 100% -> draw NOTHING (no bars, no labels, and the
   * DOM-measuring subsysClusterY() is skipped too, so a healthy ship
   * pays ~zero for this per frame). Any subsystem below 100% -> draw
   * ONLY the damaged ones, compactly stacked from the same historical
   * anchor (x=10, label gutter 34 + bar 120 = 154 wide, rows on a 13px
   * pitch), so the painted box can never exceed the historical
   * 154 x (5*13-4 = 61) anchor box the pips route around. Integrity
   * values and the <50% critical blink are unchanged. */
  var subsysClusterStats = { drawnIds: [], box: null, anchorY: 0, frames: 0 };
  function drawSubsysCluster(ctx) {
    var s = subsys();
    if (!s || !P) {
      subsysClusterStats.drawnIds = [];
      subsysClusterStats.box = null;
      return;
    }
    var damaged = [];
    for (var i = 0; i < SF.SUBSYSTEMS.length; i++) {
      var def0 = SF.SUBSYSTEMS[i];
      var v0 = clampSub(s[def0.id]);
      if (v0 < 100) damaged.push({ def: def0, v: v0 });
    }
    subsysClusterStats.frames++;
    subsysClusterStats.drawnIds = damaged.map(function (d) { return d.def.id; });
    if (!damaged.length) {
      subsysClusterStats.box = null;
      subsysClusterStats.anchorY = 0;
      return; // pristine ship: silence is the status report
    }
    var c = document.getElementById('game');
    if (!c) { subsysClusterStats.box = null; return; }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var x = 10, y = subsysClusterY(), bw = 120, bh = 9, gap = 13;
    subsysClusterStats.anchorY = y;
    subsysClusterStats.box = { x: x, y: y, w: 34 + bw,
                               h: damaged.length * gap - (gap - bh) };
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '9px system-ui, sans-serif';
    for (var di = 0; di < damaged.length; di++) {
      var def = damaged[di].def;
      var v = damaged[di].v;
      var by = y + di * gap;
      ctx.fillStyle = 'rgba(8,12,24,0.72)';
      ctx.fillRect(x + 34, by, bw, bh);
      ctx.fillStyle = def.color;
      ctx.fillRect(x + 34, by, Math.round(bw * v / 100), bh);
      if (v < 50) {
        var blink = (Math.floor(performance.now() / 400) % 2) === 0;
        ctx.strokeStyle = blink ? '#ff5e3a' : 'rgba(255,94,58,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 34 + 0.5, by + 0.5, bw - 1, bh - 1);
      }
      ctx.fillStyle = v < 50 ? '#ff8c7a' : '#9db0cc';
      ctx.fillText(def.icon + ' ' + Math.round(v) + '%', x, by + bh / 2 + 1);
    }
    ctx.restore();
  }

  /* Reactor selector widget, screen-space (canvas-drawn). Tapping it cycles.
   * stance-tabs-combat-gate: the stance TABS are combat-relative chrome —
   * out of combat (per SF.CombatHUD, combat-context-hud) they are not drawn
   * at all. The HEAT BAR + vent/overheat status line are safety state, not
   * chrome: they still draw out of combat whenever heat > 1% or a vent is
   * running (the exception the combat-context-hud report prescribes).
   * SF.CombatHUD is read defensively every frame: absent or malformed
   * (older trees, partial installs, this phase staged standalone) counts as
   * IN combat, i.e. the widget draws exactly as it did before this phase. */
  var widgetRect = null;
  function drawReactorWidget(ctx) {
    if (!P || !P.reactor) { widgetRect = null; return; }
    var c = document.getElementById('game');
    if (!c) { widgetRect = null; return; }
    var rect = c.getBoundingClientRect();
    var W = rect.width;
    var R = P.reactor;
    var defs = SF.REACTOR_PROFILES;
    /* stance-widget-shrink (2026-10-23, the user's circled screenshots):
     * tabs shrunk (46x16, was 62x20) and the widget moved out of the
     * center stack to the top-right — right-aligned so the row ends
     * 8px left of the minimap wrap, the spot he pointed at. Minimap
     * width: 96px, 72px on narrow portrait, 64px on short
     * coarse-pointer screens (css/style.css #minimap media queries). */
    var cw = 46, ch = 16, gap = 4, y = 56;
    var totalW = defs.length * cw + (defs.length - 1) * gap;
    var mmW = 96;
    if (W <= 480) mmW = 72;
    else if (window.matchMedia &&
             window.matchMedia('(pointer: coarse) and (max-height: 520px)').matches) mmW = 64;
    var x0 = Math.round(W - 10 - mmW - 8 - totalW);
    if (x0 < 4) x0 = 4;
    var inCombat = true;
    try {
      if (window.SF && SF.CombatHUD &&
          typeof SF.CombatHUD.inCombat === 'function')
        inCombat = !!SF.CombatHUD.inCombat();
    } catch (e) { inCombat = true; } // defensive: any doubt = draw as today
    var heatActive = (R.heat > 1) || (R.vent > 0);
    if (!inCombat && !heatActive) {
      widgetRect = null; // hidden tabs are not tappable; B key still cycles
      return;
    }
    ctx.save();
    // CSS-pixel drawing: match main.js resize() (dpr-scaled backing store)
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '9px system-ui, sans-serif';
    if (inCombat) {
      for (var i = 0; i < defs.length; i++) {
        var x = x0 + i * (cw + gap);
        var active = (i === R.profile);
        ctx.fillStyle = active ? 'rgba(8,12,24,0.92)' : 'rgba(8,12,24,0.72)';
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = active ? defs[i].color : 'rgba(120,150,190,0.45)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
        ctx.fillStyle = active ? defs[i].color : '#9db0cc';
        ctx.fillText(defs[i].short, x + cw / 2, y + ch / 2 + 1);
      }
    }
    // heat bar (hy = y+ch+4 = 76: tabs y=56 ch=16, 4px gap) — drawn in
    // BOTH modes whenever it is reached: in combat always (as before),
    // out of combat only via the heat/vent exception above.
    var hy = y + ch + 4;
    ctx.fillStyle = 'rgba(8,12,24,0.72)';
    ctx.fillRect(x0, hy, totalW, 5);
    var hw = Math.round(totalW * Math.min(1, R.heat / 100));
    ctx.fillStyle = R.vent > 0 ? '#ff4d6d' :
      (R.heat > 66 ? '#ff4d6d' : (R.heat > 33 ? '#ffd24d' : '#57d98a'));
    ctx.fillRect(x0, hy, hw, 5);
    ctx.strokeStyle = 'rgba(120,150,190,0.45)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, hy + 0.5, totalW - 1, 4);
    // status line: conditional — vent countdown or overheat warning only
    // (hud-center-stack-fix: idle/cooldown/status info removed to de-clutter
    // the center stack; shown only when it demands attention)
    if (R.vent > 0 || R.heat > 66) {
      ctx.font = '10px system-ui, sans-serif';
      var status, scolor = '#ff4d6d';
      if (R.vent > 0) {
        status = '⚙ VENTING ' + R.vent.toFixed(1) + 's — stats halved';
      } else {
        status = 'HEAT ' + Math.round(R.heat) + '% — overheat!';
      }
      ctx.fillStyle = scolor;
      ctx.fillText(status, x0 + totalW / 2, hy + 17);
    }
    ctx.restore();
    /* The hit rect tracks what is actually painted. In combat: the full
     * block (tabs + heat bar), unchanged. Out of combat (heat/vent
     * exception only): just the visible heat strip stays tappable — a tap
     * there cycles the profile, and cycleProfile() pokes CombatHUD.enter,
     * so the tabs reappear the moment they are used. The hidden tab row
     * itself is NOT a tap target. */
    widgetRect = inCombat
      ? { x: x0, y: y, w: totalW, h: (hy + 6) - y }
      : { x: x0, y: hy, w: totalW, h: 6 };
  }

  /* ---- ship-paint-jobs: paint ownership + tint rendering ----
   * Account-wide ownership (bought once each): P.paint = { owned, active }.
   * Rendering: offscreen source-atop tint copy of the ship sprite, cached per
   * classId|paintId; procedural fallback hull blends cls.color toward the
   * tint. Engine flame/glow overlays stay untouched. */
  var PAINT_BY_ID = {};
  SF.PAINT_JOBS.forEach(function (j) { PAINT_BY_ID[j.id] = j; });
  var PAINT_DEFAULT = 'factory';

  function validPaintId(id) { return !!(id && PAINT_BY_ID[id]); }

  /* Defensive paint state: create() always stamps it; older saves and
   * sessions that predate this phase get factory defaults. */
  function paintState() {
    if (!P) return { owned: { factory: true }, active: PAINT_DEFAULT };
    if (!P.paint) P.paint = { owned: {}, active: PAINT_DEFAULT };
    if (!P.paint.owned) P.paint.owned = {};
    P.paint.owned[PAINT_DEFAULT] = true; // factory finish is always owned
    if (!validPaintId(P.paint.active)) P.paint.active = PAINT_DEFAULT;
    return P.paint;
  }
  function activePaintDef() {
    return PAINT_BY_ID[paintState().active] || PAINT_BY_ID[PAINT_DEFAULT];
  }

  /* tiny hex mixer for the procedural-fallback hull tint */
  function mixHex(a, b, t) {
    function ch(h, i) { return parseInt(h.substr(i, 2), 16); }
    if (typeof a !== 'string' || typeof b !== 'string' ||
        !/^#[0-9a-fA-F]{6}$/.test(a) || !/^#[0-9a-fA-F]{6}$/.test(b)) return a;
    var r = Math.round(ch(a, 1) + (ch(b, 1) - ch(a, 1)) * t);
    var g = Math.round(ch(a, 3) + (ch(b, 3) - ch(a, 3)) * t);
    var bl = Math.round(ch(a, 5) + (ch(b, 5) - ch(a, 5)) * t);
    return '#' + [r, g, bl].map(function (v) {
      var s = Math.max(0, Math.min(255, v)).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  var tintCache = {};
  /* Tinted copy of the ship sprite, or the raw sprite for the factory
   * finish. Returns null when the loader has no decoded image yet — the
   * caller keeps its procedural hull path, so a missing/loading sprite
   * never breaks. Cached canvases are per (classId, paintId). */
  function tintedSprite(classId, paint) {
    if (!(window.SF && SF.Sprites)) return null;
    var img = SF.Sprites.get('ships', classId);
    if (!img || !img.complete || !img.naturalWidth) return null;
    if (!paint || !paint.tint) return img; // factory finish: untouched sprite
    var key = classId + '|' + paint.id;
    if (tintCache[key]) return tintCache[key];
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = (paint.tintAlpha != null) ? paint.tintAlpha : 0.45;
    g.fillStyle = paint.tint;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    tintCache[key] = c;
    return c;
  }

  /* ship-paint-jobs: full buy/apply/render API for the shipyard UI.
   * A follow-up phase (builder.js/station.js scope) wires the DOM; the
   * paintShopHTML() snippet is ready to drop into the builder identity
   * section next to the rename/transponder controls. */
  var paintJobsAPI = {
    defs: function () { return SF.PAINT_JOBS.slice(); },
    defOf: function (id) {
      return PAINT_BY_ID[validPaintId(id) ? id : PAINT_DEFAULT];
    },
    validId: validPaintId,
    isOwned: function (id) {
      return !!paintState().owned[validPaintId(id) ? id : PAINT_DEFAULT];
    },
    ownedList: function () {
      var ps = paintState();
      return SF.PAINT_JOBS.filter(function (j) { return ps.owned[j.id]; })
        .map(function (j) { return j.id; });
    },
    activeId: function () { return paintState().active; },
    activeDef: activePaintDef,
    /* Buy a paint job once: deducts credits, marks owned.
     * Returns { ok, reason } where reason is invalid|owned|funds|null. */
    buyPaintJob: function (id) {
      if (!validPaintId(id)) return { ok: false, reason: 'invalid' };
      var ps = paintState();
      if (ps.owned[id]) return { ok: false, reason: 'owned' };
      var def = PAINT_BY_ID[id];
      /* shop-launch: premium paints are Dark Matter purchases routed
       * through SF.Shop — the credits path below never applies. */
      if (def.premium) {
        if (!(window.SF && SF.Shop && SF.Shop.buyPremiumPaint)) return { ok: false, reason: 'invalid' };
        var pr = SF.Shop.buyPremiumPaint(id);
        if (!pr.ok) return pr;
        ps.owned[id] = true;
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('🎨 ' + def.name + ' unlocked — apply it to repaint your hull.');
        if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
        return { ok: true, reason: null };
      }
      if ((P.credits || 0) < def.price) return { ok: false, reason: 'funds' };
      P.credits -= def.price;
      ps.owned[id] = true;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('🎨 ' + def.name + ' unlocked — apply it to repaint your hull.');
      if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
      return { ok: true, reason: null };
    },
    /* shop-launch: grant a paint with no charge (redeem codes). */
    grantPaintJob: function (id) {
      if (!validPaintId(id)) return false;
      paintState().owned[id] = true;
      return true;
    },
    /* Apply an owned paint job to the hull. Returns true on success. */
    applyPaintJob: function (id) {
      if (!validPaintId(id)) return false;
      var ps = paintState();
      if (!ps.owned[id]) return false;
      ps.active = id;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('🎨 Hull repainted: ' + PAINT_BY_ID[id].name + '.');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      return true;
    },
    /* DOM snippet for the shipyard/builder identity section. Handlers are
     * data-attribute hooks (data-paint-buy / data-paint-apply) for the
     * wiring phase to bind — this file touches no other UI file. */
    paintShopHTML: function () {
      var ps = paintState();
      var h = '<div class="paintshop-list">';
      SF.PAINT_JOBS.forEach(function (j) {
        var owned = !!ps.owned[j.id];
        var active = ps.active === j.id;
        h += '<div class="paintshop-row" data-paint-id="' + j.id + '">' +
          '<span class="paint-swatch" style="background:' + (j.tint || '#9db0cc') + '"></span>' +
          '<span class="paint-name">' + j.name + '</span> ' +
          '<span class="dim">' + (j.premium ? '◆' + j.dmPrice + ' DM' : (j.price ? j.price + 'c' : 'stock')) + '</span> ' +
          (active ? '<b>APPLIED</b>' :
            owned ? '<button class="ui-block" data-paint-apply="' + j.id + '">Apply</button>' :
            '<button class="ui-block" data-paint-buy="' + j.id + '">Buy ' + j.price + 'c</button>') +
          '</div>';
      });
      return h + '</div>';
    },
    /* test hook: tinted canvas (or raw sprite for factory), null pre-decode */
    tintedSprite: tintedSprite
  };

  /* ---- engine-wake-vfx: idle glow, dock/undock bursts, afterburner hand-off ----
   * Save-neutral: everything here is runtime-only, no SF.SAVE_VERSION bump.
   * wakeBoosting() is a READ-ONLY check of SF.Afterburner.state() (main.js) —
   * this file never writes afterburner state. Transitions are auto-detected
   * in SF.Player.draw, which runs every frame in every game state; SF.Wake
   * stays public so a future station.js wiring phase can also call
   * SF.Wake.dockBurst()/undockBurst() directly at the dock/undock call sites. */
  var wakeLastState = null;
  function wakeBoosting() {
    try {
      return !!(window.SF && SF.Afterburner && SF.Afterburner.state &&
        SF.Afterburner.state().boostOn);
    } catch (e) { return false; }
  }
  /* idle engine glow pulse in sprite (nose-up) space; tail at +y */
  function wakeIdleGlowSprite(ctx, r) {
    var a = 0.25 + 0.20 * (0.5 + 0.5 * Math.sin(performance.now() / 240));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    var g = ctx.createRadialGradient(0, r * 0.95, 0, 0, r * 0.95, r * 0.75);
    g.addColorStop(0, '#9fd8ff');
    g.addColorStop(1, 'rgba(80,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, r * 0.95, r * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /* idle engine glow pulse in fallback scaled space; tail at (-12, 0) */
  function wakeIdleGlowFallback(ctx) {
    var a = 0.25 + 0.20 * (0.5 + 0.5 * Math.sin(performance.now() / 240));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    var g = ctx.createRadialGradient(-12, 0, 0, -12, 0, 10);
    g.addColorStop(0, '#9fd8ff');
    g.addColorStop(1, 'rgba(80,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(-12, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function wakeBurst(kind) {
    if (!(window.SF && SF.Particles)) return;
    var r = radius();
    if (kind === 'undock') {
      var bx = P.x - Math.cos(P.angle) * (r + 4), by = P.y - Math.sin(P.angle) * (r + 4);
      SF.Particles.burst(bx, by, '#7fd4ff', 14, 220, 0.7, 3);
      SF.Particles.burst(bx, by, '#ffffff', 5, 130, 0.4, 2);
    } else {
      SF.Particles.burst(P.x, P.y, '#7fd4ff', 10, 170, 0.6, 3);
      SF.Particles.burst(P.x, P.y, '#bfe9ff', 4, 110, 0.4, 2);
    }
  }
  function wakeTrackState() {
    var st = (window.SF && SF.Game && SF.Game.state) || null;
    if (wakeLastState === null) { wakeLastState = st; return; }
    if (st === 'DOCKED' && wakeLastState === 'PLAYING') wakeBurst('dock');
    else if (st === 'PLAYING' && wakeLastState === 'DOCKED') wakeBurst('undock');
    wakeLastState = st;
  }
  /* engine-wake-vfx: publish the public wake-burst API on SF. */
  SF.Wake = {
    dockBurst: function () { wakeBurst('dock'); },
    undockBurst: function () { wakeBurst('undock'); },
    testReset: function () { wakeLastState = null; },
    _debug: function () { return { lastState: wakeLastState, boosting: wakeBoosting() }; }
  };

  /* ---- sprite-wiring-ships: file-backed sprite hull ----
   * Tries SF.Sprites.get('ships', classId) and draws the 256x256 nose-up PNG
   * rotated to the ship heading. Returns true when the sprite path rendered.
   * Returns false on miss/loading/disabled loader — the caller then keeps its
   * procedural hull draw, so the game never breaks on a missing sprite.
   * Engine-glow/trail particles stay untouched (trail lives in update()).
   * ship-paint-jobs: the tinted source-atop copy of the sprite is drawn
   * instead of the raw image when a paid paint job is active. */
  function drawSpriteHull(ctx, r) {
    if (!(window.SF && SF.Sprites)) return false;
    var id = activeShip().classId;
    var img = tintedSprite(id, activePaintDef()); // ship-paint-jobs: tinted copy when a paid job is active
    if (!img) return false;
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(P.angle + Math.PI / 2); // sprites are authored nose-up
    var d = r * 2;
    /* twelve-hour-wave4 readability: one dark halo disc under the sprite
     * so the hull reads against bright nebulae/stations at phone size.
     * A canvas fill only — no extra drawImage, so the S25 drawImage
     * budget is untouched. */
    ctx.fillStyle = 'rgba(4,8,18,0.50)';
    ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(img, -r, -r, d, d);
    if (P.thrust > 0) {
      if (wakeBoosting()) {
        // engine-wake-vfx: afterburner hand-off — boosting swaps the standard
        // thrust flare for a cyan wake plume (read-only SF.Afterburner check).
        var wpl = (34 + Math.random() * 14) * Math.max(0.6, r / 16);
        ctx.fillStyle = '#8fd8ff';
        ctx.beginPath();
        ctx.moveTo(-r * 0.34, r * 0.75);
        ctx.lineTo(0, r * 0.75 + wpl);
        ctx.lineTo(r * 0.34, r * 0.75);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.14, r * 0.75);
        ctx.lineTo(0, r * 0.75 + wpl * 0.55);
        ctx.lineTo(r * 0.14, r * 0.75);
        ctx.closePath(); ctx.fill();
      } else {
        // engine flame at the tail (+y in sprite space), sized to the ship
        var fl = (10 + Math.random() * 8) * Math.max(0.6, r / 16);
        ctx.fillStyle = '#ff9d2e';
        ctx.beginPath();
        ctx.moveTo(-r * 0.30, r * 0.75);
        ctx.lineTo(0, r * 0.75 + fl);
        ctx.lineTo(r * 0.30, r * 0.75);
        ctx.closePath(); ctx.fill();
      }
      // engine-glow variant, additive + throttle-animated
      // b-perf: skipped on the s25 tier (thrust flame + hull remain).
      var s25ship = !!(window.SF && SF.FX && SF.FX.getEffective &&
                       SF.FX.getEffective() === 's25');
      var glow = s25ship ? null : SF.Sprites.get('ships', id + '_glow');
      if (glow) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 130));
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glow, -r, -r, d, d);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    } else if (P.alive) {
      // engine-wake-vfx: idle engine glow pulse at the tail when not thrusting
      wakeIdleGlowSprite(ctx, r);
    }
    ctx.restore();
    return true;
  }

  return {
    get x() { return P.x; }, set x(v) { P.x = v; },
    get y() { return P.y; }, set y(v) { P.y = v; },
    get hull() { return P.hull; }, set hull(v) { P.hull = v; },
    get shield() { return P.shield; }, set shield(v) { P.shield = v; },
    get credits() { return P.credits; }, set credits(v) { P.credits = v; },
    get ore() { return P.ore; }, set ore(v) { P.ore = v; },
    get radius() { return radius(); },
    get angle() { return P.angle; },
    get inventory() { return P.inventory; },
    get weaponsOwned() { return P.weaponsOwned; },
    set weaponsOwned(v) { P.weaponsOwned = v; },
    get weaponIndex() { return P.weaponIndex; },
    set weaponIndex(v) { P.weaponIndex = v; },
    get upgrades() { return P.upgrades; },
    set upgrades(v) { P.upgrades = v; },
    get alive() { return P.alive; },
    get ships() { return P.ships; },
    set ships(v) { P.ships = v; },
    get activeShip() { return P.activeShip; },
    set activeShip(v) { P.activeShip = v; },
    get partInventory() { return P.partInventory; },
    set partInventory(v) { P.partInventory = v; },
    /* ---- weapons-arsenal: weapon mod inventory ---- */
    get modsInv() { return P.modsInv || {}; },
    set modsInv(v) { P.modsInv = v; },

    /* ---- Phase 4: factions, karma, quests, companions ---- */
    get factionState() { return P.factions; },
    get karmaState() { return P.karma; },
    set karmaState(v) { P.karma = v; },
    get questState() { return P.quests; },
    get companionState() { return P.companions; },
    /* gameplay-depth: bounty board state */
    get bountyState() { return P.bounties; },
    get shipwrightDiscount() { return P.shipwrightDiscount || 1; },
    set shipwrightDiscount(v) { P.shipwrightDiscount = v; },

    /* ---- story-campaign: story progress blob ---- */
    get storyState() { return P.story; },
    set storyState(v) { P.story = v; },
    storyDefault: function () {
      return (window.SF && SF.StoryDefault) ? SF.StoryDefault() : {
        introSeen: false, fall: 0, fallKills: 0,
        arcs: { compact: 0, drifters: 0, ember: 0 }, arcKills: {},
        peace: { compact: false, drifters: false, ember: false },
        finale: null, finaleDone: false, finaleKills: 0,
        waypoint: null, lastOre: 0, mined: 0
      };
    },

    /* ---- Phase 5: trading, homebase, secrets ---- */
    get goods() { return P.goods; },
    set goods(v) { P.goods = v; },
    get markets() { return P.markets; },
    set markets(v) { P.markets = v; },
    get homebase() { return P.homebase; },
    set homebase(v) { P.homebase = v; },
    get secretsState() { return P.secrets; },
    set secretsState(v) { P.secrets = v; },

    /* ---- planets-facilities: news feed, contraband hold, black-market state ---- */
    get news() { return P.news; },
    set news(v) { P.news = v; },
    get contraband() { return P.contraband; },
    set contraband(v) { P.contraband = v; },
    get bmarket() { return P.bmarket; },
    set bmarket(v) { P.bmarket = v; },

    /* Cargo: ore + trade goods + contraband share the hold. Base 20t + fitted cargo parts. */
    cargoUsed: function () {
      var t = P.ore || 0;
      var gs = P.goods || {};
      Object.keys(gs).forEach(function (k) { t += gs[k] || 0; });
      // planets-facilities: contraband rides in the same hold
      var cb = P.contraband || {};
      Object.keys(cb).forEach(function (k) { t += cb[k] || 0; });
      return Math.floor(t);
    },
    cargoSpace: function () {
      return (SF.CONFIG.trading ? SF.CONFIG.trading.baseCargo : 20) + buildStats().cargo;
    },

    /* ---- Phase 3: crew ---- */
    crewList: function () { return activeShip().crew; },
    crewCount: function () { return SF.Crew.count(activeShip()); },
    isAdrift: function () {
      var sh = activeShip();
      return P.alive && sh.hadCrew && sh.crew.length === 0;
    },
    hireToShip: function (member, shipIdx) {
      var sh = P.ships[shipIdx];
      if (!sh) return false;
      var cap = SF.Parts.derive(sh.classId, sh.parts).crewCap;
      if (sh.crew.length >= cap) return false;
      sh.crew.push(member);
      sh.hadCrew = true;
      return true;
    },
    bestCrewShip: function () {
      // ship index with the most free crew capacity
      var best = -1, bestFree = -1;
      for (var i = 0; i < P.ships.length; i++) {
        var sh = P.ships[i];
        var cap = SF.Parts.derive(sh.classId, sh.parts).crewCap;
        var free = cap - sh.crew.length;
        if (free > bestFree) { bestFree = free; best = i; }
      }
      return bestFree > 0 ? best : -1;
    },

    activeShipDef: function () { return activeShip(); },
    activeClassDef: function () { return activeClass(); },
    buildStats: function () { return buildStats(); },
    /* ---- set-bonuses phase: manufacturer set bonuses (pure, save-neutral) ---- */
    setBonusesFor: function (classId, fitted) { return setBonusesFor(classId, fitted); },
    activeSetBonuses: function () {
      var sh = activeShip();
      return setBonusesFor(sh.classId, sh.parts);
    },
    setMul: function (stat) { return setMul(stat); },
    setBonusBadgeHTML: function (classId, fitted) { return setBonusBadgeHTML(classId, fitted); },
    activeSetBonusBadgeHTML: function () {
      var sh = activeShip();
      return setBonusBadgeHTML(sh.classId, sh.parts);
    },
    /* ---- power-profiles: reactor power profiles (runtime-only, save-neutral) ---- */
    cycleProfile: function () { return cycleProfile(); },
    profileMul: function (stat) { return profMul(stat); },
    reactorState: function () { return (P && P.reactor) ? P.reactor : null; },
    widgetRect: function () { return widgetRect; },
    /* ---- subsystem-damage-repair: session-scoped subsystem API ---- */
    subsystems: function () {
      var s = subsys();
      return s ? { engines: s.engines, weapons: s.weapons, shields: s.shields,
                   sensors: s.sensors, life: s.life } : null;
    },
    subsystemIntegrity: function (id) {
      var s = subsys();
      return (s && typeof s[id] === 'number') ? s[id] : 100;
    },
    damageSubsystems: function (total, srcX, srcY) {
      return damageSubsystems(total, srcX, srcY);
    },
    subsystemMissing: function () {
      var s = subsys();
      if (!s) return 0;
      var m = 0;
      SF.SUBSYSTEMS.forEach(function (d) { m += 100 - s[d.id]; });
      return Math.round(m);
    },
    repairSubsystems: function () {
      var s = subsys();
      if (!s) return 0;
      var m = this.subsystemMissing();
      SF.SUBSYSTEMS.forEach(function (d) { s[d.id] = 100; });
      return m;
    },
    /* Field patch: consume one nano-paste, +20 to every subsystem. */
    useNanoPaste: function () {
      var s = subsys();
      if (!s || !P || !P.alive) return false;
      if (!((P.inventory || {})[SF.NANO_PASTE_ID] > 0)) return false;
      if (this.subsystemMissing() <= 0) return false;
      P.inventory[SF.NANO_PASTE_ID]--;
      var restored = 0;
      SF.SUBSYSTEMS.forEach(function (d) {
        var b = s[d.id];
        s[d.id] = clampSub(b + SF.NANO_PASTE_RESTORE);
        restored += s[d.id] - b;
      });
      try {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('🧪 Nano-paste applied — subsystems +' + Math.round(restored) + ' integrity.');
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        if (window.SF && SF.FX && SF.FX.damageNumber)
          SF.FX.damageNumber(P.x, P.y, restored, { type: 'heal', color: '#3ddc5f' });
      } catch (e) {}
      return true;
    },
    engineSpeedMul: function () { return engineSpeedMul(); },
    weaponRateMul: function () { return weaponRateMul(); },
    shieldDelayMul: function () { return shieldDelayMul(); },
    sensorRangeMul: function () { return sensorRangeMul(); },
    weapHeatState: function () {
      return { heat: P ? (P.weapHeat || 0) : 0, vent: P ? (P.weapVent || 0) : 0 };
    },
    _subsysDebug: function () {
      return { subsys: this.subsystems(), heat: P ? (P.weapHeat || 0) : 0,
               vent: P ? (P.weapVent || 0) : 0,
               muls: { speed: engineSpeedMul(), rate: weaponRateMul(),
                       delay: shieldDelayMul(), range: sensorRangeMul() } };
    },
    /* hud-declutter-2 test hooks (same debug-hook pattern as
     * _subsysDebug / SF.Raids.debugTrigger): _subsysClusterDebug
     * reports what the last drawSubsysCluster call actually painted —
     * which subsystem ids, the painted box, and the historical anchor
     * zone it must stay inside (x=10, w=154, h=61, y measured from the
     * DOM by subsysClusterY). _subsysTestSet sets ONE subsystem's
     * integrity directly (damageSubsystems() always spreads across
     * all five, so a single-damaged-system state is otherwise
     * unreachable from a test). */
    _subsysClusterDebug: function () {
      return {
        drawnIds: subsysClusterStats.drawnIds.slice(),
        drawnCount: subsysClusterStats.drawnIds.length,
        box: subsysClusterStats.box ? { x: subsysClusterStats.box.x,
               y: subsysClusterStats.box.y, w: subsysClusterStats.box.w,
               h: subsysClusterStats.box.h } : null,
        anchorY: subsysClusterStats.anchorY,
        frames: subsysClusterStats.frames,
        zone: { x: 10, w: 154, h: SF.SUBSYSTEMS.length * 13 - 4,
                top: subsysClusterY() }
      };
    },
    _subsysTestSet: function (id, v) {
      var s = subsys();
      if (!s || !SUBSYS_BY_ID[id]) return -1;
      s[id] = clampSub(v);
      return s[id];
    },
    /* ---- ship-paint-jobs: paint shop API (buy/apply/tint, save-neutral) ---- */
    paintJobs: paintJobsAPI,
    weaponSlots: function () { return buildStats().slots; },
    crewCapacity: function () { return buildStats().crewCap; },

    create: function () {
      P = {
        x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2,
        hull: 0, shield: 0, // set from build below
        regenTimer: 0, fireTimer: 0,
        weaponsOwned: [{ id: 'pulse', stars: 1 }], weaponIndex: 0,
        upgrades: { engine: false, shield: false },
        credits: 60, ore: 0, inventory: {},
        ships: [{ name: 'SF-1', classId: 'fighter', parts: SF.Parts.starterFit('fighter'),
                   crew: [], hadCrew: false }],
        activeShip: 0,
        partInventory: {},
        modsInv: {}, // weapons-arsenal: lootable weapon mod inventory
        alive: true, thrust: 0,
        // power-profiles: reactor power profiles (runtime only, never serialized)
        reactor: { profile: 0, heat: 0, vent: 0, cooldown: 0 },
        // ship-paint-jobs: paint ownership + active job (additive, save-neutral)
        paint: { owned: { factory: true }, active: 'factory' },
        // subsystem-damage-repair: session-scoped integrity (never serialized,
        // resets to 100% on new game AND on load — deserialize() calls create())
        subsys: freshSubsys(),
        weapHeat: 0, weapVent: 0,
        // Phase 4: factions/karma/quests/companions
        factions: { compact: 0, drifters: 0, ember: 0 },
        karma: 0,
        quests: { offers: [], active: [], done: 0, pendingAmbush: null },
        companions: { hired: [], active: [] },
        shipwrightDiscount: 1,
        // story-campaign: intro + The Fall + faction arcs + finale
        story: this.storyDefault(),
        // Phase 5: trading, homebase, secrets
        goods: {}, markets: {}, homebase: null,
        secrets: { investigated: {}, anomalyDone: false, found: 0 },
        // gameplay-depth: bounty board (offers re-rolled per dock, one active)
        bounties: { offers: [], active: null, done: 0 },
        // planets-facilities: news feed, contraband hold, black-market state
        news: { feed: [], seen: 0 },
        contraband: {},
        bmarket: { mul: {}, jobsDone: [] }
      };
      P.hull = maxHull(); P.shield = maxShield();
    },

    reset: function (x, y) {
      this.create();
      P.x = x; P.y = y;
    },

    currentWeapon: function () {
      var entry = P.weaponsOwned[P.weaponIndex];
      if (!entry) return null;
      var def = SF.WEAPON_BY_ID[entry.id];
      if (!def) return null;
      var w = Object.assign({}, def);
      w.stars = entry.stars;
      return w;
    },

    currentWeaponEntry: function () { return P.weaponsOwned[P.weaponIndex] || null; },

    /* Which mount part carries weapon i? Fit order, deterministic:
     * first weapon -> first mount part (expanded by its slot count). */
    mountForWeapon: function (i) {
      var sh = activeShip();
      var mounts = [];
      for (var k = 0; k < sh.parts.length; k++) {
        var fp = sh.parts[k];
        var pd = SF.PART_BY_ID[fp.partId];
        if (pd && pd.type === 'mount') {
          var nslots = Math.round(SF.Parts.effStats(fp).slots || 0);
          for (var s = 0; s < nslots; s++) mounts.push(pd);
        }
      }
      if (!mounts.length) return null;
      return mounts[Math.min(i, mounts.length - 1)];
    },

    cycleWeapon: function () {
      var n = Math.min(this.weaponSlots(), P.weaponsOwned.length);
      if (n < 2) return;
      P.weaponIndex = (P.weaponIndex + 1) % n;
      SF.Audio.ui();
    },

    hasWeapon: function (id) {
      for (var i = 0; i < P.weaponsOwned.length; i++) {
        if (P.weaponsOwned[i].id === id) return true;
      }
      return false;
    },

    weaponEntry: function (id) {
      for (var i = 0; i < P.weaponsOwned.length; i++) {
        if (P.weaponsOwned[i].id === id) return P.weaponsOwned[i];
      }
      return null;
    },

    addWeapon: function (id) {
      if (!this.hasWeapon(id)) {
        var entry = { id: id, stars: 1, mods: [] };
        if (window.SF && SF.Mods) SF.Mods.normalize(entry);
        P.weaponsOwned.push(entry);
      }
    },

    addPart: function (partId, n) {
      P.partInventory[partId] = (P.partInventory[partId] || 0) + (n || 1);
    },

    takePart: function (partId) {
      if ((P.partInventory[partId] || 0) <= 0) return false;
      P.partInventory[partId]--;
      return true;
    },

    buyShip: function (classId, price) {
      var cls = SF.SHIP_CLASS_BY_ID[classId];
      var cost = (price !== undefined) ? price : (cls ? cls.price : 0);
      if (!cls || P.credits < cost) return false;
      P.credits -= cost;
      P.ships.push({
        name: cls.name + ' ' + (P.ships.length + 1),
        classId: classId,
        parts: SF.Parts.starterFit(classId),
        crew: [], hadCrew: false
      });
      return true;
    },

    setActiveShip: function (i) {
      if (i < 0 || i >= P.ships.length) return false;
      var hullFrac = maxHull() > 0 ? P.hull / maxHull() : 1;
      P.activeShip = i;
      // clamp weapon index to new slot count
      var n = Math.min(this.weaponSlots(), P.weaponsOwned.length);
      if (P.weaponIndex >= n) P.weaponIndex = 0;
      // refit hull/shield to new build, keep damage proportion
      P.hull = Math.round(maxHull() * hullFrac);
      P.shield = Math.min(P.shield, maxShield());
      return true;
    },

    maxHull: function () { return maxHull(); },
    maxShield: function () { return maxShield(); },
    speed: function () { return effectiveSpeed(); },

    /* twelve-hour-wave2: feel introspection (smoke-test hooks + tuning).
     * recoil(): live kick state; shieldShimmer(): shimmer timer active;
     * muzzleSizeFor()/kickFor(): per-kind feel values. */
    recoil: function () { return { kick: P.kick || 0, ang: P.kickAng || 0 }; },
    shieldShimmer: function () { return (P.shieldHitT || 0) > 0; },
    muzzleSizeFor: function (kind) { return muzzleSizeFor(kind); },
    kickFor: function (kind) { return kickFor(kind); },

    takeDamage: function (dmg, srcX, srcY) {
      if (!P.alive) return;
      P.regenTimer = 0;
      var remaining = dmg;
      if (P.shield > 0) {
        var absorbed = Math.min(P.shield, remaining);
        P.shield -= absorbed; remaining -= absorbed;
        SF.Audio.shieldHit();
        /* twelve-hour-wave2: shield-hit shimmer timer — the shield ring
         * draw brightens while this runs (see draw()). */
        P.shieldHitT = 0.45;
        if (P.shield <= 0 && SF.Audio.shieldBreak) SF.Audio.shieldBreak();
        // b1-wire-fx: shield-variant ring sprite on shield hits (cyan on a
        // hit, magenta when the hit breaks the shield); shieldHit() keeps
        // the old '#3fa9ff' burst as fallback when art is unavailable.
        // radius() is closure-scoped; typeof-guard keeps old saves safe.
        SF.Particles.shieldHit(P.x, P.y, P.shield <= 0,
          (typeof radius === 'function' ? radius() : 16) * 2 + 26);
      }
      if (remaining > 0) {
        var mh = maxHull();
        var oldFrac = mh > 0 ? P.hull / mh : 1;
        P.hull -= remaining;
        SF.Audio.hit();
        if (P.hull > 0 && mh > 0 && P.hull / mh < 0.3 && SF.Audio.hullAlarm) SF.Audio.hullAlarm();
        /* twelve-hour-wave2: low-hull crossing warning — one toast the
         * first time hull drops below 30%, re-armed on repair above 50%
         * (see update()). The DamageFX vignette + CombatFeed warn line
         * already fire at 30%/25%; this toast names the state plainly so
         * a phone-size player cannot miss it. Hull shake itself is
         * reduced at low hull by the SF.FX.shake gate (fx.js). */
        if (P.hull > 0 && mh > 0) {
          var nf = P.hull / mh;
          if (oldFrac >= 0.30 && nf < 0.30 && !P._lowHullToasted) {
            P._lowHullToasted = true;
            if (window.SF && SF.HUD && SF.HUD.toast)
              SF.HUD.toast('⚠ HULL CRITICAL — ' + Math.round(nf * 100) + '% — dock or retreat!');
          }
        }
        SF.Particles.burst(P.x, P.y, '#ff8c2e', 8, 200, 0.4, 3);
        SF.HUD.damageFlash();
        if (window.SF && SF.FX) SF.FX.shake(6); // graphics-juice: shake on hull hit
        // Phase 3: crew depletion — each 10% of max hull lost kills ~10% of crew
        var newFrac = mh > 0 ? Math.max(0, P.hull) / mh : 1;
        var step = SF.CONFIG.crew.depleteHullStep;
        var steps = Math.floor(oldFrac / step) - Math.floor(newFrac / step);
        var sh = activeShip();
        if (steps > 0 && sh.crew.length > 0) {
          var deadTotal = [];
          for (var s = 0; s < steps && sh.crew.length > 0; s++) {
            var n = Math.max(1, Math.round(sh.crew.length * SF.CONFIG.crew.depleteCrewFrac));
            deadTotal = deadTotal.concat(SF.Crew.killMembers(sh.crew, n, true));
          }
          if (deadTotal.length > 0) {
            var names = deadTotal[0].name + (deadTotal.length > 1 ? ' +' + (deadTotal.length - 1) + ' more' : '');
            SF.HUD.toast('☠ Crew lost: ' + names);
            SF.Audio.explosion(false);
            if (sh.crew.length === 0 && sh.hadCrew) SF.HUD.toast('🆘 ADRIFT — no crew left!');
            // crew-depth-wiring: morale hit to survivors + refresh perk cache
            if (window.SF && SF.Crew && SF.Crew.onMemberDeath) {
              SF.Crew.onMemberDeath(sh, deadTotal);
              SF.Crew.recalcPerks(sh);
            }
          }
        }
      }
      // b2-combat-feedback: taken damage number (red, anchored at the
      // player ship), keyed 'player' so rapid hits within 150 ms aggregate
      // (fx.js). Display only; shows the full incoming hit (shield +
      // hull), placed before the death check so the killing blow shows.
      try {
        if (window.SF && SF.FX && SF.FX.damageNumber)
          SF.FX.damageNumber(P.x, P.y, dmg, { type: 'taken', key: 'player' });
      } catch (err) {}
      if (P.hull <= 0) {
        P.hull = 0; P.alive = false;
        SF.Game.onPlayerDeath();
      }
      /* subsystem-damage-repair: hull-through hits batter subsystems,
       * weighted by impact location (srcX/srcY when the caller knows it). */
      if (remaining > 0 && P.alive) {
        var subDealt = damageSubsystems(remaining * SF.SUBSYS_DMG_FRAC, srcX, srcY);
        if (subDealt >= 4) subsysFeed(subDealt);
      }
    },

    heal: function (amount) {
      P.hull = Math.min(maxHull(), P.hull + amount);
    },

    update: function (dt, input) {
      if (!P.alive) return;
      reactorTick(dt); // power-profiles: heat / vent / switch-cooldown advance every frame
      subsysTick(dt); // subsystem-damage-repair: weapon heat, morale drain, lock clamp
      // twelve-hour-wave2: feel timers decay — recoil kick (~0.13s) and
      // shield shimmer (0.45s); low-hull toast re-arms above 50% hull.
      if (P.kick > 0) P.kick = Math.max(0, P.kick - dt * 40);
      if (P.shieldHitT > 0) P.shieldHitT = Math.max(0, P.shieldHitT - dt);
      if (P._lowHullToasted && maxHull() > 0 && P.hull / maxHull() >= 0.5)
        P._lowHullToasted = false;
      // crew-depth-wiring: shipboard perks from the live crew roster (guarded, additive).
      // critBonus feeds the crit roll in the fire block; cooldownMul scales the
      // fire interval; hullRegen is passive hull repair per second.
      var crewP = (window.SF && SF.Crew && SF.Crew.perks) ? SF.Crew.perks(activeShip()) : null;
      if (this.isAdrift()) {
        // Phase 3: adrift — no thrust, no fire. Drift on last velocity.
        P.x += P.vx * dt; P.y += P.vy * dt;
        var damp = Math.max(0, 1 - 0.4 * dt);
        P.vx *= damp; P.vy *= damp;
        // open-space-1: no walls — an adrift ship drifts wherever it drifts.
        // (Region membership is computed from the galaxy frame in SF.Space.)
        P.thrust = 0;
        P.regenTimer += dt;
        if (P.regenTimer >= SF.CONFIG.player.shieldRegenDelay * shieldDelayMul() && P.shield < maxShield()) {
          // set-bonuses: Vantia line multiplies regen
          // power-profiles: reactor profile multiplies regen (adrift branch)
          // subsystem-damage-repair: damaged shields lengthen the recharge delay
          // twelve-hour-wave3 (B2): Engineering regen multiplies the rate
          P.shield = Math.min(maxShield(),
            P.shield + SF.CONFIG.player.shieldRegen * setMul('regen') * profMul('regen') * skillMul('regenMul') * dt);
        }
        return;
      }
      var sp = effectiveSpeed();
      var tx = input.mx * sp, ty = input.my * sp;
      /* twelve-hour-wave3 (B2): Piloting accel scales the velocity-lerp
       * rate (the model's acceleration); 8/s is the unskilled rate. */
      var k = Math.min(1, 8 * skillMul('accelMul') * dt);
      P.vx += (tx - P.vx) * k; P.vy += (ty - P.vy) * k;
      P.x += P.vx * dt; P.y += P.vy * dt;
      // open-space-1: no walls — flight is unbounded; SF.Space decides
      // region membership from the galaxy frame, and deep space is open.
      // (r survives the clamp removal: the engine-trail block below
      // offsets its puffs by the ship radius.)
      var r = radius();

      var moving = Math.hypot(P.vx, P.vy) > 30;
      if (moving) {
        var want = Math.atan2(P.vy, P.vx);
        var d = want - P.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        /* twelve-hour-wave3 (B2): Piloting handling scales the turn-lerp
         * rate (the model's handling); 12/s is the unskilled rate. */
        P.angle += d * Math.min(1, 12 * skillMul('handlingMul') * dt);
      }
      P.thrust = moving ? 1 : 0;

      // graphics-juice: engine trail puffs while thrusting
      if (P.thrust > 0) {
        P.trailT = (P.trailT || 0) + dt;
        if (P.trailT > 0.035) {
          P.trailT = 0;
          /* twelve-hour-wave2: boost trail reads cyan vs amber cruise
           * (same single refreshed trail slot — zero extra drawImages). */
          SF.Particles.thrust(
            P.x - Math.cos(P.angle) * (r + 6),
            P.y - Math.sin(P.angle) * (r + 6),
            P.angle, wakeBoosting() ? 'puff-cyan' : undefined);
        }
      }

      // shield regen
      P.regenTimer += dt;
      if (P.regenTimer >= SF.CONFIG.player.shieldRegenDelay * shieldDelayMul() && P.shield < maxShield()) {
        // set-bonuses: Vantia line multiplies regen
        // power-profiles: reactor profile multiplies regen
        // subsystem-damage-repair: damaged shields lengthen the recharge delay
        // twelve-hour-wave3 (B2): Engineering regen multiplies the rate
        P.shield = Math.min(maxShield(),
          P.shield + SF.CONFIG.player.shieldRegen * setMul('regen') * profMul('regen') * skillMul('regenMul') * dt);
      }
      // crew-depth-wiring: marine perk — passive hull repair from the crew
      if (crewP && crewP.hullRegen > 0 && P.hull < maxHull()) {
        P.hull = Math.min(maxHull(), P.hull + crewP.hullRegen * dt);
      }

      // firing — turret mounts track the aim stick 360°, fixed mounts fire
      // forward along ship facing. Idle aim stick = forward fire (unchanged).
      // Damage scales with weapon stars.
      P.fireTimer -= dt;
      var w = this.currentWeapon();
      if (!w) return;
      var wcfg = SF.CONFIG.weapons[w.id];
      var dmgMul = SF.Upgrade.starMult(w.stars || 1);
      if (input.firing && P.fireTimer <= 0 && (P.weapVent || 0) <= 0) {
        var entry = this.currentWeaponEntry();
        // weapons-arsenal: mods multiply damage, fire rate and range
        // set-bonuses: Helion line multiplies weapon damage
        // power-profiles: reactor profile multiplies damage
        var dmgMul = SF.Upgrade.starMult(w.stars || 1) * SF.Mods.damageMul(entry) * setMul('dmg') * profMul('dmg');
        var rate = wcfg.fireRate * SF.Mods.rateMul(entry);
        rate *= weaponRateMul(); // subsystem-damage-repair: damaged weapons fire slower
        var range = SF.Mods.rangeMul(entry);
        // crew-depth-wiring: gunner perk — crit chance (x2 damage roll);
        // engineer perk — weapon cooldown multiplier on the fire interval.
        var critCh = (crewP ? crewP.critBonus : 0);
        var isCrit = critCh > 0 && Math.random() < critCh;
        P.fireTimer = (1 / rate) * (crewP ? crewP.cooldownMul : 1);
        var mount = this.mountForWeapon(P.weaponIndex);
        var isTurret = !!(mount && mount.turret);
        var fireAngle = (isTurret && input.aimActive) ? input.aimAngle : P.angle;
        /* beta-aim: close-range drag-aim snap (turret + aim stick only).
         * Never touches FIRE-button forward fire, and never runs when the
         * stick is idle — the snap only corrects a drag-aim the player
         * already made, toward the lead-predicted intercept. */
        var snapDbg = { snapped: false, dist: null, errBeforeDeg: null, errAfterDeg: null };
        if (isTurret && input.aimActive) {
          try {
            var snap = snapTargetFor(P.x, P.y, fireAngle);
            if (snap) {
              var spd = (wcfg.projectileSpeed || 640);
              var tt = snap.dist / spd;
              var lx = snap.e.x + (snap.e.vx || 0) * tt;
              var ly = snap.e.y + (snap.e.vy || 0) * tt;
              var lead = Math.atan2(ly - P.y, lx - P.x);
              var bear = Math.atan2(snap.e.y - P.y, snap.e.x - P.x);
              snapDbg = { snapped: true, dist: Math.round(snap.dist),
                errBeforeDeg: Math.abs(angDiffSnap(bear, input.aimAngle)) * 180 / Math.PI,
                errAfterDeg: Math.abs(angDiffSnap(bear, lead)) * 180 / Math.PI };
              fireAngle = lead;
            }
          } catch (eSnap) { /* assist-only: a snap failure never breaks the shot */ }
        }
        this._aimSnap = snapDbg;
        var nx = P.x + Math.cos(fireAngle) * (r + 6);
        var ny = P.y + Math.sin(fireAngle) * (r + 6);
        var tgt = null;
        if (wcfg.homing) {
          // subsystem-damage-repair: damaged sensors shrink seeker acquisition
          var best = 520 * sensorRangeMul(), el = SF.Enemies.list;
          for (var k = 0; k < el.length; k++) {
            var tdx = el[k].x - P.x, tdy = el[k].y - P.y;
            var tdd = Math.hypot(tdx, tdy);
            if (tdd < best) { best = tdd; tgt = el[k]; }
          }
        }
        for (var i = 0; i < wcfg.pellets; i++) {
          var off = wcfg.pellets === 1 ? 0 :
            (i - (wcfg.pellets - 1) / 2) * (wcfg.spread / Math.max(1, wcfg.pellets - 1)) * 2;
          var a = fireAngle + off + (Math.random() - 0.5) * 0.03;
          SF.Projectiles.spawn(nx, ny, a, wcfg.projectileSpeed, wcfg.damage * dmgMul * (isCrit ? 2 : 1), true, w.color,
            { radius: wcfg.mine ? 7 : (w.id === 'seeker' || w.id === 'seeker_mk2' ? 5 : 3),
              kind: wcfg.kind || 'bolt',
              homing: !!wcfg.homing, turn: wcfg.homingTurn || 0,
              life: (wcfg.life || 1.6) * range, target: tgt,
              blast: wcfg.blast || 0, emp: wcfg.emp || 0, mine: !!wcfg.mine,
              crit: isCrit });
        }
        SF.Audio.weaponSound(w.id);
        // b1-wire-fx: weapon-kind-matched muzzle sprite (kind-aware flash);
        // muzzle() keeps the old burst as fallback when art is unavailable.
        // twelve-hour-wave2: per-kind flash size + visual-only recoil kick
        // (ship offset in draw(); velocity untouched, so no balance change).
        SF.Particles.muzzle(nx, ny, w.color, wcfg.kind, muzzleSizeFor(wcfg.kind));
        P.kick = kickFor(wcfg.kind); P.kickAng = fireAngle;
        // subsystem-damage-repair: weapon heat. Damaged guns build heat up to
        // 3x faster; a healthy ship's passive cooling outpaces normal buildup,
        // so overheat only bites when the weapons subsystem is hurt.
        P.weapHeat = Math.min(100, (P.weapHeat || 0) +
          SF.WEAP_HEAT_PER_SHOT * weaponHeatMul());
        if (P.weapHeat >= 100) {
          P.weapVent = SF.WEAP_VENT_TIME;
          try {
            if (SF.HUD && SF.HUD.toast)
              SF.HUD.toast('🔥 WEAPONS OVERHEATED — venting ' + SF.WEAP_VENT_TIME + 's');
            if (SF.Audio && SF.Audio.hullAlarm) SF.Audio.hullAlarm();
          } catch (e) {}
        }
      }
    },

    draw: function (ctx) {
      // engine-wake-vfx: auto-detect DOCKED<->PLAYING transitions every frame
      // (draw runs in all states); fires dock/undock wake bursts once each.
      wakeTrackState();
      if (!P.alive) return;
      var r = radius(), s = r / 13; // scale base shape to ship size
      var cls = activeClass();
      /* twelve-hour-wave2: recoil kick — brief rearward offset of hull +
       * shield ring only (widgets below are unshifted). Visual only. */
      var kickOn = (P.kick || 0) > 0.05;
      if (kickOn) {
        ctx.save();
        ctx.translate(-Math.cos(P.kickAng || 0) * P.kick,
                      -Math.sin(P.kickAng || 0) * P.kick);
      }
      // sprite-wiring-ships: file-backed sprite hull; procedural fallback on null
      if (!drawSpriteHull(ctx, r)) {
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.rotate(P.angle);
      ctx.scale(s, s);
      // engine flame
      if (P.thrust > 0) {
        if (wakeBoosting()) {
          // engine-wake-vfx: afterburner hand-off — wake plume replaces the
          // standard orange flare while boosting (read-only SF.Afterburner check).
          var wpl = 34 + Math.random() * 14;
          ctx.fillStyle = '#8fd8ff';
          ctx.beginPath();
          ctx.moveTo(-12, -4); ctx.lineTo(-12 - wpl, 0); ctx.lineTo(-12, 4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.moveTo(-12, -2); ctx.lineTo(-12 - wpl * 0.55, 0); ctx.lineTo(-12, 2);
          ctx.closePath(); ctx.fill();
        } else {
          var fl = 10 + Math.random() * 8;
          ctx.fillStyle = '#ff9d2e';
          ctx.beginPath();
          ctx.moveTo(-12, -4); ctx.lineTo(-12 - fl, 0); ctx.lineTo(-12, 4);
          ctx.closePath(); ctx.fill();
        }
      } else {
        // engine-wake-vfx: idle engine glow pulse at idle throttle
        wakeIdleGlowFallback(ctx);
      }
      // hull (class-tinted)
      // ship-paint-jobs: blend the active paint tint into the fallback hull
      var __pd = activePaintDef();
      ctx.fillStyle = (__pd && __pd.tint)
        ? mixHex(cls.color, __pd.tint, 0.5) : cls.color;
      ctx.beginPath();
      ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-5, 0); ctx.lineTo(-10, 11);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(10,18,36,0.55)';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6);
      ctx.closePath(); ctx.fill();
      // cockpit
      ctx.fillStyle = '#dff3ff';
      ctx.beginPath(); ctx.arc(4, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      }
      // shield ring — hud-sprite-improve: energy-bubble sprite first
      // (fx/shield/ring-blue shipped unwired), plain stroke as fallback
      if (P.shield > 0) {
        var shImg = (window.SF && SF.Sprites) ? SF.Sprites.get('fx/shield', 'ring-blue') : null;
        ctx.save();
        if (shImg) {
          var shS = (r + 10) * 2;
          /* twelve-hour-wave2: shield-hit shimmer — ring brightens for
           * 0.45s after a shield hit (P.shieldHitT, set in takeDamage). */
          ctx.globalAlpha = Math.min(0.95, 0.55 + 0.15 * Math.sin(performance.now() / 300) +
            ((P.shieldHitT || 0) > 0 ? 0.30 : 0));
          ctx.translate(P.x, P.y);
          ctx.rotate(performance.now() / 2400);
          ctx.drawImage(shImg, -shS / 2, -shS / 2, shS, shS);
        } else {
          ctx.globalAlpha = Math.min(0.7, 0.25 + 0.1 * Math.sin(performance.now() / 300) +
            ((P.shieldHitT || 0) > 0 ? 0.25 : 0));
          ctx.strokeStyle = '#3fa9ff';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(P.x, P.y, r + 6, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      if (kickOn) ctx.restore(); // twelve-hour-wave2: end recoil offset
      // twin-stick aim indicator
      if (SF.Input.aimActive) {
        var aa = SF.Input.aimAngle;
        ctx.save();
        ctx.strokeStyle = '#ff9d5e';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(P.x + Math.cos(aa) * (r + 8), P.y + Math.sin(aa) * (r + 8));
        ctx.lineTo(P.x + Math.cos(aa) * (r + 30), P.y + Math.sin(aa) * (r + 30));
        ctx.stroke();
        ctx.restore();
      }
      drawReactorWidget(ctx); // power-profiles: selector widget + heat bar
      drawSubsysCluster(ctx); // subsystem-damage-repair: integrity bars under the DOM bars
      // wingman-formations: formation selector widget (canvas-drawn chips)
      if (window.SF && SF.WingmanFormations) SF.WingmanFormations.drawFormationWidget(ctx);
    },

    serialize: function () {
      return {
        x: P.x, y: P.y, hull: P.hull, shield: P.shield,
        weaponsOwned: P.weaponsOwned.map(function (e) {
          return { id: e.id, stars: e.stars, mods: (e.mods || []).slice() };
        }),
        weaponIndex: P.weaponIndex,
        modsInv: Object.assign({}, P.modsInv || {}),
        // ship-paint-jobs: paint ownership blob (additive, defensive reads, save-neutral)
        paint: { owned: Object.assign({}, paintState().owned),
                 active: paintState().active },
        upgrades: { engine: P.upgrades.engine, shield: P.upgrades.shield },
        credits: P.credits, ore: P.ore, inventory: Object.assign({}, P.inventory),
        ships: P.ships.map(function (sh) {
          return { name: sh.name, classId: sh.classId,
            parts: sh.parts.map(function (fp) {
              return { partId: fp.partId, gx: fp.gx, gy: fp.gy,
                       rotated: !!fp.rotated, stars: fp.stars || 1 };
            }),
            crew: (sh.crew || []).map(function (m) {
              return { name: m.name, role: m.role, stars: m.stars };
            }),
            hadCrew: !!sh.hadCrew };
        }),
        activeShip: P.activeShip,
        partInventory: Object.assign({}, P.partInventory),
        // Phase 4
        factions: Object.assign({}, P.factions),
        karma: P.karma || 0,
        quests: JSON.parse(JSON.stringify(P.quests || { offers: [], active: [], done: 0 })),
        companions: JSON.parse(JSON.stringify(P.companions || { hired: [], active: [] })),
        shipwrightDiscount: P.shipwrightDiscount || 1,
        // story-campaign
        story: JSON.parse(JSON.stringify(P.story || this.storyDefault())),
        // Phase 5
        goods: Object.assign({}, P.goods || {}),
        markets: JSON.parse(JSON.stringify(P.markets || {})),
        homebase: P.homebase ? JSON.parse(JSON.stringify(P.homebase)) : null,
        secrets: JSON.parse(JSON.stringify(P.secrets || { investigated: {}, anomalyDone: false, found: 0 })),
        // gameplay-depth
        bounties: JSON.parse(JSON.stringify(P.bounties || { offers: [], active: null, done: 0 })),
        // planets-facilities
        news: JSON.parse(JSON.stringify(P.news || { feed: [], seen: 0 })),
        contraband: Object.assign({}, P.contraband || {}),
        bmarket: JSON.parse(JSON.stringify(P.bmarket || { mul: {}, jobsDone: [] }))
      };
    },

    deserialize: function (d) {
      this.create();
      P.x = d.x; P.y = d.y;
      P.hull = d.hull; P.shield = d.shield;
      P.weaponsOwned = (d.weaponsOwned || []).map(function (e) {
        var entry = typeof e === 'string'
          ? { id: e, stars: 1, mods: [] }
          : { id: e.id, stars: e.stars || 1, mods: (e.mods || []).slice() };
        if (window.SF && SF.Mods) SF.Mods.normalize(entry);
        return entry;
      });
      P.weaponIndex = d.weaponIndex || 0;
      P.modsInv = Object.assign({}, d.modsInv || {});
      // ship-paint-jobs: additive paint blob, defensive (save-neutral, no bump)
      P.paint = {
        owned: Object.assign({ factory: true },
          ((d.paint && d.paint.owned) || {})),
        active: validPaintId(d.paint && d.paint.active) ? d.paint.active : PAINT_DEFAULT
      };
      P.upgrades = { engine: !!(d.upgrades && d.upgrades.engine), shield: !!(d.upgrades && d.upgrades.shield) };
      P.credits = d.credits; P.ore = d.ore;
      P.inventory = Object.assign({}, d.inventory || {});
      if (d.ships && d.ships.length) {
        P.ships = d.ships.map(function (sh) {
          return { name: sh.name, classId: sh.classId,
            parts: (sh.parts || []).map(function (fp) {
              return { partId: fp.partId, gx: fp.gx, gy: fp.gy,
                       rotated: !!fp.rotated, stars: fp.stars || 1 };
            }),
            crew: (sh.crew || []).map(function (m) {
              return { name: m.name, role: m.role, stars: m.stars || 1 };
            }),
            hadCrew: !!sh.hadCrew };
        });
        P.activeShip = Math.min(d.activeShip || 0, P.ships.length - 1);
      }
      P.partInventory = Object.assign({}, d.partInventory || {});
      // Phase 4
      P.factions = Object.assign({ compact: 0, drifters: 0, ember: 0 }, d.factions || {});
      P.karma = d.karma || 0;
      P.quests = d.quests || { offers: [], active: [], done: 0, pendingAmbush: null };
      P.companions = d.companions || { hired: [], active: [] };
      P.shipwrightDiscount = d.shipwrightDiscount || 1;
      // story-campaign
      P.story = d.story ? JSON.parse(JSON.stringify(d.story)) : this.storyDefault();
      // Phase 5
      P.goods = Object.assign({}, d.goods || {});
      P.markets = d.markets || {};
      P.homebase = d.homebase || null;
      P.secrets = d.secrets || { investigated: {}, anomalyDone: false, found: 0 };
      // gameplay-depth: bounty board state
      P.bounties = d.bounties || { offers: [], active: null, done: 0 };
      // planets-facilities: news feed, contraband, black-market state
      P.news = d.news ? JSON.parse(JSON.stringify(d.news)) : { feed: [], seen: 0 };
      P.contraband = Object.assign({}, d.contraband || {});
      P.bmarket = d.bmarket ? JSON.parse(JSON.stringify(d.bmarket)) : { mul: {}, jobsDone: [] };
      P.hull = Math.min(P.hull, maxHull());
      P.shield = Math.min(P.shield, maxShield());
    }
  };
})();

/* ---- power-profiles: B keybind + reactor widget tap ----
 * B is ALSO the boarding key (input.js boardKey, consumed by main.js for
 * SF.Boarding). Conflict rule, kept here so this phase stays js/ship.js-only:
 * when a boardable target is in range, boarding wins and the profile does NOT
 * cycle; otherwise B cycles the reactor profile. The keydown handler runs at
 * event time (before main.js's per-frame consumeBoardKey), so both stay
 * consistent via the same SF.Boarding.findTarget() check.
 * Widget tap: window capture-phase touchstart runs before input.js's canvas
 * joystick handlers; a tap inside the last-drawn widget rect cycles the
 * profile and never reaches the sticks. Desktop: plain mousedown. */
(function () {
  function playing() {
    return window.SF && SF.Game && SF.Game.state === 'PLAYING';
  }
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyB' || e.repeat) return;
    if (!playing()) return;
    var tgt = (window.SF && SF.Boarding && SF.Boarding.findTarget)
      ? SF.Boarding.findTarget(SF.Player) : null;
    if (tgt) return; // boarding takes priority; main.js opens it next frame
    SF.Player.cycleProfile();
  });
  var lastTapT = 0;
  function widgetTap(cx, cy) {
    if (!playing()) return false;
    var wr = SF.Player.widgetRect ? SF.Player.widgetRect() : null;
    if (!wr) return false;
    if (cx >= wr.x && cx <= wr.x + wr.w && cy >= wr.y && cy <= wr.y + wr.h) {
      SF.Player.cycleProfile();
      return true;
    }
    return false;
  }
  window.addEventListener('touchstart', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (widgetTap(t.clientX, t.clientY)) {
        lastTapT = Date.now();
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }
    }
  }, { capture: true, passive: false });
  window.addEventListener('mousedown', function (e) {
    if (Date.now() - lastTapT < 600) return; // ignore touch-emulated mouse
    widgetTap(e.clientX, e.clientY);
  });
})();

/* subsystem-damage-repair: R key — emergency field patch with nano-paste.
 * Silent no-op when nothing is wrong; a throttled hint when the player has
 * no paste (craft it at any station workbench). */
(function () {
  function playing() {
    return window.SF && SF.Game && SF.Game.state === 'PLAYING';
  }
  var lastHintT = 0;
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyR' || e.repeat) return;
    if (!playing()) return;
    if (!(window.SF && SF.Player && SF.Player.useNanoPaste)) return;
    if (SF.Player.useNanoPaste()) return;
    var now = Date.now();
    if (now - lastHintT < 5000) return;
    lastHintT = now;
    var inv = (SF.Player.inventory || {})[SF.NANO_PASTE_ID] || 0;
    if (inv <= 0 && window.SF && SF.HUD && SF.HUD.toast)
      SF.HUD.toast('🧪 No nano-paste — craft it at a station workbench.');
  });
})();

/* Migrate a v1 player blob to v2: wrap weapons, add ships + part inventory. */
SF.Player.migrateV1 = function (d) {
  d.weaponsOwned = (d.weaponsOwned || ['pulse']).map(function (id) {
    return { id: (typeof id === 'string' ? id : id.id), stars: 1 };
  });
  d.ships = [{ name: 'SF-1', classId: 'fighter', parts: SF.Parts.starterFit('fighter'),
               crew: [], hadCrew: false }];
  d.activeShip = 0;
  d.partInventory = {};
  return d;
};

/* Migrate a v2 player blob to v3: add crew rosters to ships. */
SF.Player.migrateV2 = function (d) {
  (d.ships || []).forEach(function (sh) {
    sh.crew = sh.crew || [];
    sh.hadCrew = !!sh.hadCrew;
  });
  return d;
};

/* Migrate a v3 player blob to v4: factions, karma, quests, companions. */
SF.Player.migrateV3 = function (d) {
  d.factions = d.factions || { compact: 0, drifters: 0, ember: 0 };
  d.karma = (d.karma !== undefined) ? d.karma : 0;
  d.quests = d.quests || { offers: [], active: [], done: 0, pendingAmbush: null };
  d.companions = d.companions || { hired: [], active: [] };
  d.shipwrightDiscount = d.shipwrightDiscount || 1;
  return d;
};

/* Migrate a v4 player blob to v5: trading goods + markets, homebase, secrets. */
SF.Player.migrateV4 = function (d) {
  d.goods = d.goods || {};
  d.markets = d.markets || {};
  d.homebase = (d.homebase !== undefined) ? d.homebase : null;
  d.secrets = d.secrets || { investigated: {}, anomalyDone: false, found: 0 };
  return d;
};

/* Migrate a v7 player blob to v8: secrets2 defaults (anomalies/dungeon/lifepod). */
SF.Player.migrateV7 = function (d) {
  var s = d.secrets || { investigated: {}, anomalyDone: false, found: 0 };
  if (!s.anomalies2Done) s.anomalies2Done = {};
  if (!s.dungeon) s.dungeon = { room: 0, bossSpawned: false, cleared: false, hint: false };
  if (typeof s.lifepodSeen === 'undefined') s.lifepodSeen = false;
  if (typeof s.lifepodDone === 'undefined') s.lifepodDone = false;
  if (typeof s.completionist === 'undefined') s.completionist = false;
  d.secrets = s;
  return d;
};
/* Migrate a v6 player blob to v7: story campaign progress blob. */
SF.Player.migrateV6 = function (d) {
  d.story = d.story || SF.Player.storyDefault();
  return d;
};
/* Migrate a v8 player blob to v9: bounty board state (gameplay-depth). */
SF.Player.migrateV8 = function (d) {
  d.bounties = d.bounties || { offers: [], active: null, done: 0 };
  return d;
};
/* Migrate a v9 player blob to v10: news feed, contraband, black-market state. */
SF.Player.migrateV9 = function (d) {
  d.news = d.news || { feed: [], seen: 0 };
  d.contraband = d.contraband || {};
  d.bmarket = d.bmarket || { mul: {}, jobsDone: [] };
  return d;
};
SF.Player.migrateV5 = function (d) {
  d.modsInv = d.modsInv || {};
  (d.weaponsOwned || []).forEach(function (e) {
    var def = SF.WEAPON_BY_ID[e.id || e];
    var n = def ? (def.modSlots || 1) : 1;
    e.mods = Array.isArray(e.mods) ? e.mods.slice(0, n) : [];
    while (e.mods.length < n) e.mods.push(null);
  });
  return d;
};

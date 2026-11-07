/* STARFALL graphics-juice — fx.js
 * Screen shake (trauma model), per-system nebula backgrounds, quality tiers,
 * floating damage numbers (damage-numbers-retry),
 * and (backgrounds-wiring) webp vista background layers.
 *
 * Quality: setting 'auto' | 'high' | 'low', persisted in localStorage
 * ('starfall_quality' — a device preference, NOT part of the versioned save
 * blob, so no save-schema bump). Auto resolves adaptively: devices with
 * <=4 CPU cores or <=4 GB RAM get Low (Galaxy S25 and desktops get High).
 * Low tier: particle counts x0.35, nebula off, single starfield layer,
 * and NO vista layers (procedural only).
 * b-perf: a fourth effective tier, 's25', for Android-mobile (the S25 APK
 * target). Auto resolves to it on Android-mobile user agents; it is also
 * settable programmatically via setQuality('s25') (the title toggle cycles
 * auto/high/low only, unchanged). s25 keeps the full High look — nebula +
 * vistas + 2 starfield planes — but degrades the expensive per-frame
 * work: particles x0.6, no engine/boss glow drawImages, no explosion
 * smoke stamps, and projectiles render through the existing batched
 * procedural path instead of one drawImage per bolt (projectiles.js).
 * No gameplay numbers change on any tier: spawns, damage, loot, timings
 * are identical; only how already-spawned things are painted changes.
 *
 * Vista wiring (backgrounds-wiring phase, js/fx.js only): SF.BG is a cached
 * Image loader for assets/bg/<name>.webp following the ASSETS.md loader
 * contract (404/undecodable -> null, never throws; callers keep their
 * procedural fallback). SF.FX.drawNebula layers the shipped vistas over the
 * procedural nebula based on game context it reads lazily from the SF
 * global (no edits to main.js were in scope):
 *   deepfield          -> far parallax base, always (high tier)
 *   <system>_nebula    -> per-system nebula (solace/drift/ember)
 *   ember_surface_vista-> warm overlay while in the Ember system
 *   hollow_cathedral_backdrop -> near the Hollow Cathedral dungeon
 *   arena_drift_vista  -> while an SF.Arena gauntlet is active
 *   void_anomaly_deep  -> near the deep-space anomaly
 *   solace_docks_vista -> dock approach in Solace (station_vista elsewhere)
 *   station_vista      -> while DOCKED
 *   wormhole_vista     -> jump flash on system change (see note below)
 * Wormhole note: the live tree has no wormhole entity yet (only planned
 * wormhole_open/wormhole_exit SFX ids in the sfx-bank-v2 queue brief), so
 * there is nothing "on screen" to tint. wormhole_vista instead drives the
 * jump flash: SF.FX.setSystem() fires it whenever the system actually
 * changes (covers SF.Game.travelTo jumps). A future wormhole phase can call
 * SF.FX.jumpFlashNow() directly or tint off SF.Arena-style state.
 * Damage-numbers note: damage-numbers-retry (js/fx.js only) exposes
 * SF.FX.damageNumber(x, y, amount, opts) — fixed pool of numbers that float
 * up and fade over ~0.8s, drawn batched by (color,size) in drawNumbers(ctx)
 * (world space; wired in main.js render() after SF.Particles.draw(ctx),
 * plus updateNumbers(dt) after SF.FX.update(dt)). Types: dealt (white),
 * yellow (heavy dealt), crit (orange, larger), taken (red), heal (teal,
 * '+N'). Low tier: 1-in-2 spawns dropped, 0.8x font. b2-combat-feedback:
 * pool capped at 24 live, same-key hits within 150 ms aggregate, hooks
 * in enemies.js damage() (dealt) and ship.js takeDamage() (taken).
 * No damage is applied inside js/fx.js.
 * title_nebula is NOT wired here: main.js's TITLE branch never calls into
 * SF.FX (out of scope for this phase). SF.FX.drawTitleVista(ctx, vw, vh)
 * is provided for it — one line in main.js's TITLE render branch:
 *   SF.FX.drawTitleVista(ctx, vw, vh);
 * Save-neutral: no SF.SAVE_VERSION bump, no save-blob changes.
 */
window.SF = window.SF || {};

/* SF.BG — cached webp vista loader (backgrounds-wiring).
 * get(name): returns the decoded HTMLImageElement for
 *   assets/bg/<name>.webp, or null while still loading / on 404 /
 *   undecodable. Never throws. Missing ids are pinned so a 404 doesn't
 *   retry every frame. Callers ALWAYS keep their procedural fallback:
 *   null means "draw procedurally", never "draw nothing".
 */
SF.BG = (function () {
  var BASE = 'assets/bg/';

  var cache = {}; // name -> { img, state: 'loading' | 'ready' | 'missing' }
  var draws = {}; // name -> drawImage count (smoke-test hook)

  function get(name) {
    try {
      var key = String(name);
      var e = cache[key];
      if (e) return e.state === 'ready' ? e.img : null;
      var img = new Image();
      cache[key] = { img: img, state: 'loading' };
      img.onload = function () { cache[key].state = 'ready'; };
      img.onerror = function () { cache[key].state = 'missing'; };
      img.onabort = function () { cache[key].state = 'missing'; };
      img.src = BASE + key + '.webp';
      return null; // first call: caller draws its fallback this frame
    } catch (err) {
      return null; // never throws
    }
  }

  function ready(name) {
    var e = cache[String(name)];
    return !!(e && e.state === 'ready');
  }

  function preload(names) {
    if (!names || !names.length) return;
    for (var i = 0; i < names.length; i++) get(names[i]);
  }

  function noteDraw(name) {
    draws[name] = (draws[name] || 0) + 1;
  }

  function drawStats() {
    var o = {};
    for (var k in draws) { if (draws.hasOwnProperty(k)) o[k] = draws[k]; }
    return o;
  }

  return {
    get: get,
    ready: ready,
    preload: preload,
    drawStats: drawStats,
    resetDraws: function () { draws = {}; },
    _noteDraw: noteDraw, // internal: SF.FX records each real drawImage
    _stats: function () { // internal test hook: loader states
      var n = { loading: 0, ready: 0, missing: 0 };
      for (var k in cache) { if (cache.hasOwnProperty(k)) n[cache[k].state]++; }
      return n;
    }
  };
})();

SF.FX = (function () {
  var QKEY = 'starfall_quality';
  var setting = 'auto';
  var effective = 'high';
  var trauma = 0;
  var initialized = false;

  // fixed-size offscreen nebula, stretched over the viewport at draw time
  var NEB_W = 1680, NEB_H = 1050;
  var nebula = null; // { canvas, systemId }

  var NEBULA_TINTS = {
    solace: ['#0e3a5c', '#164a75', '#0a2a4a'],
    drift:  ['#3a1c5c', '#4e2a70', '#2a1545'],
    ember:  ['#5c1e14', '#722d1a', '#471a10']
  };

  /* backgrounds-wiring: every shipped vista layer, preloaded at init so the
   * first visit to a zone doesn't pop. ~1.3MB total for all 12. */
  var VISTA_NAMES = [
    'deepfield',
    'solace_nebula', 'drift_nebula', 'ember_nebula',
    'title_nebula', 'station_vista',
    'solace_docks_vista', 'ember_surface_vista', 'hollow_cathedral_backdrop',
    'wormhole_vista', 'arena_drift_vista', 'void_anomaly_deep'
  ];

  var curSystem = 'solace';
  var jumpFlash = 0;          // seconds of wormhole_vista fade remaining
  var JUMP_FLASH_T = 1.4;

  /* final-kill-slowmo-retry: cinematic finisher beat on boss/elite kills.
   * Runtime-only state (nothing persisted, save-neutral, no save bump).
   * The clock is driven by updateFinisher() with REAL dt from the main
   * loop's frame(), so the 1.2s beat stays wall-clock while the game
   * itself runs at timeScale(). */
  var FIN_T1 = 0.9;           // slow-mo beat at 0.25x
  var FIN_T2 = 0.3;           // ease back to 1.0x
  var FIN_ZOOM = 1.6;         // peak camera zoom on the kill point
  var FLASH_T = 0.4;          // desaturation-flash fade
  var finActive = false, finT = 0;
  var finKX = 0, finKY = 0;   // kill point (world)
  var finSX = 0, finSY = 0;   // camera focus at trigger (world)

  /* b2-combat-feedback: floating combat numbers, WIRED (this slice).
   * Fixed pool + one batched draw pass, same conventions as particles.js.
   * Wiring (added this slice, main.js only):
   *   frame():  after SF.FX.update(dt)       -> SF.FX.updateNumbers(dt)
   *   render(): after SF.Particles.draw(ctx) -> SF.FX.drawNumbers(ctx)
   *             (world space, PLAYING only)
   * Damage hooks (display only, no gameplay numbers change):
   *   enemies.js damage() -> dealt number, keyed per enemy for aggregation
   *   ship.js takeDamage() -> taken number (red), keyed 'player'
   *   ship.js subsysFeed / heal calls pre-date this slice and keep working.
   * Pool cap: NUM_POOL = 24 live numbers max (task cap ~24). A spawn
   * beyond the pool is dropped, never queued, never allocated.
   * Aggregation: hits on the same key within AGG_WINDOW (150 ms) merge
   * into one running total (life refreshed, position updated) so a beam
   * or rapid-fire weapon shows one climbing number, not a wall of text.
   * Toggle: no combat-feedback toggle exists in the settings overlay
   * (audio-only + haptics), so this slice hardcodes ON per spec and adds
   * only a programmatic flag: SF.FX.setCombatFeedback(bool), persisted
   * in localStorage ('starfall_combat_feedback', device pref, NOT save).
   * Runtime-only, save-neutral (no save-blob changes, no version bump). */
  var NUM_POOL = 24;          // b2-combat-feedback: hard live cap (~24)
  var NUM_LIFE = 0.8;         // seconds a number stays alive
  var NUM_RISE = 64;          // px/s initial upward velocity
  var AGG_WINDOW = 0.15;      // b2: merge same-key hits within 150 ms
  var numTime = 0;            // b2: clock advanced by updateNumbers(dt)
  var numAgg = {};            // b2: key -> { slot, total, t }
  var numAggCount = 0;        // b2: live aggregation entries (bounded)
  var FB_KEY = 'starfall_combat_feedback'; // b2: device pref, NOT save
  var feedbackOn = true;      // b2: hardcoded ON (no settings-UI toggle)
  try {
    var _fb = localStorage.getItem(FB_KEY);
    if (_fb === '0' || _fb === 'off') feedbackOn = false;
  } catch (e) {}
  var NUM_FONT = 'bold {s}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var NUM_TYPES = {
    dealt:  { color: '#ffffff', size: 15 },
    yellow: { color: '#ffe066', size: 15 },
    crit:   { color: '#ff9500', size: 21 },
    taken:  { color: '#ff5252', size: 15 },
    heal:   { color: '#3fe0c3', size: 15 }
  };

  var numPool = [];
  var numCursor = 0;
  var numDropToggle = false;  // Low tier: drop every other spawn (reduced rate)
  (function initNumPool() {
    for (var ni = 0; ni < NUM_POOL; ni++) {
      numPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0,
                     life: 0, text: '', color: '#fff', size: 15,
                     total: 0, aggKey: null });
    }
  })();

  /* Claim the next free number slot (cursor scan). Null when the pool is
   * full — the number is dropped rather than stuttering the frame. */
  function numClaim() {
    for (var k = 0; k < NUM_POOL; k++) {
      var p = numPool[numCursor];
      numCursor = (numCursor + 1) % NUM_POOL;
      if (!p.active) return p;
    }
    return null;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  var DUNGEON_R = 900;        // px: dungeon vista fades in within this radius
  var ANOMALY_R = 900;        // px: anomaly vista fades in within this radius

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Adaptive default: low-power devices get Low, everything else High.
   * b-perf: Android-mobile (the S25 APK target) gets the intermediate
   * 's25' tier instead of High — same vistas/nebula, cheaper per-frame
   * painting. Desktops (including touch laptops) keep the old rule. */
  function detectDefault() {
    try {
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 's25';
      var cores = navigator.hardwareConcurrency || 8;
      var mem = navigator.deviceMemory || 8;
      if (cores <= 4 || mem <= 4) return 'low';
    } catch (e) {}
    return 'high';
  }

  function applyQuality() {
    if (window.SF && SF.Particles) {
      SF.Particles.setQualityScale(
        effective === 'low' ? 0.35 : (effective === 's25' ? 0.6 : 1));
    }
  }

  /* b-perf: visible world rect for the canvas's CURRENT transform
   * (world space after main.js's camera translate + finisher zoom, at
   * any dpr — same inverse-transform pattern asteroids.js already uses
   * for its field tiles). Returns null on any failure, meaning "draw
   * everything" (the pre-b-perf behavior). Callers compute this ONCE per
   * draw() and test each entity's extent rect against it; anything
   * fully outside was canvas-clipped anyway, so skipping it changes no
   * visible pixel — it only saves the drawImage / bucket pushes. */
  function viewRect(ctx) {
    try {
      var inv = ctx.getTransform().inverse();
      var w = ctx.canvas.width, h = ctx.canvas.height;
      var pts = [
        inv.transformPoint(new DOMPoint(0, 0)),
        inv.transformPoint(new DOMPoint(w, 0)),
        inv.transformPoint(new DOMPoint(0, h)),
        inv.transformPoint(new DOMPoint(w, h))
      ];
      return {
        x0: Math.min(pts[0].x, pts[1].x, pts[2].x, pts[3].x),
        y0: Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y),
        x1: Math.max(pts[0].x, pts[1].x, pts[2].x, pts[3].x),
        y1: Math.max(pts[0].y, pts[1].y, pts[2].y, pts[3].y)
      };
    } catch (e) { return null; }
  }

  /* b-perf: true when the square extent [x-r, x+r] x [y-r, y+r] overlaps
   * the view rect (or when the rect is unavailable). */
  function rectVisible(v, x, y, r) {
    if (!v) return true;
    return x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1;
  }

  function resolve() {
    effective = (setting === 'auto') ? detectDefault() : setting;
    applyQuality();
  }

  function buildNebula(systemId) {
    var cv = document.createElement('canvas');
    cv.width = NEB_W; cv.height = NEB_H;
    var c = cv.getContext('2d');
    var rnd = mulberry32(hashStr('nebula:' + systemId));
    var tints = NEBULA_TINTS[systemId] || NEBULA_TINTS.solace;
    var i, x, y, r, g;
    for (i = 0; i < 8; i++) {
      x = rnd() * NEB_W; y = rnd() * NEB_H;
      r = 150 + rnd() * 300;
      g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, tints[Math.floor(rnd() * tints.length)]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.34 + rnd() * 0.26;
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    // sparse bright knots inside the clouds
    c.globalAlpha = 1;
    for (i = 0; i < 16; i++) {
      x = rnd() * NEB_W; y = rnd() * NEB_H;
      c.fillStyle = 'rgba(255,255,255,' + (0.2 + rnd() * 0.4).toFixed(2) + ')';
      c.fillRect(x, y, 1.6, 1.6);
    }
    nebula = { canvas: cv, systemId: systemId };
  }

  /* Draw a 2048px vista cover-fit over the viewport with slow parallax.
   * Records the draw for the smoke-test hook (SF.BG.drawStats). */
  function drawVista(ctx, name, camX, camY, vw, vh, par, alpha) {
    var img = SF.BG.get(name);
    if (!img) return false; // loading or missing: caller keeps procedural layer
    var ox = -(((camX * par) % 400 + 400) % 400);
    var oy = -(((camY * par) % 400 + 400) % 400);
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(img, -200 + ox, -200 + oy, vw + 400, vh + 400);
    ctx.restore();
    SF.BG._noteDraw(name);
    return true;
  }

  /* b3-environment: region-tinted nebula with a baked distant galaxy.
   * The per-system nebula layer is pre-rendered ONCE per system into a
   * 1024px offscreen canvas: source nebula -> region tint wash
   * (source-atop, so only the nebula itself is tinted) -> the shipped
   * fx/effects/galaxy.png sprite painted dim (alpha 0.55) in the upper
   * right as a far, slow-parallax dressing object. The baked canvas then
   * REPLACES the raw nebula drawImage 1-for-1 (same geometry, parallax
   * 0.03, alpha 0.85), so the tint + galaxy cost ZERO extra canvas
   * calls per frame. Rebuilt only on system change, or once when the
   * galaxy sprite finishes loading after the first build. If anything
   * is unavailable, drawDressedNebula falls back to the raw drawVista.
   * Tints stay inside the game's dim dusk/amber direction: Solace keeps
   * its cool teal, Drift goes violet, Ember goes warm amber. */
  var REGION_TINT = {
    solace: 'rgba(56,170,190,0.20)',
    drift: 'rgba(150,90,220,0.18)',
    ember: 'rgba(255,140,50,0.16)'
  };
  var dressed = null; // { systemId, canvas, withGalaxy }

  function buildDressed(systemId) {
    var src = SF.BG.get(systemId + '_nebula');
    if (!src) return null;
    var gal = null;
    try {
      if (window.SF && SF.Sprites) gal = SF.Sprites.get('fx/effects', 'galaxy');
    } catch (e) {}
    var S = 1024;
    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var c = cv.getContext('2d');
    c.drawImage(src, 0, 0, S, S);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = REGION_TINT[systemId] || 'rgba(255,140,50,0.10)';
    c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
    if (gal) {
      c.globalAlpha = 0.55;
      c.drawImage(gal, Math.floor(S * 0.62), Math.floor(S * 0.16), 300, 300);
      c.globalAlpha = 1;
    }
    return { systemId: systemId, canvas: cv, withGalaxy: !!gal };
  }

  function drawDressedNebula(ctx, systemId, camX, camY, vw, vh) {
    if (!dressed || dressed.systemId !== systemId) {
      dressed = buildDressed(systemId);
    } else if (!dressed.withGalaxy) {
      var gal = null;
      try {
        if (window.SF && SF.Sprites) gal = SF.Sprites.get('fx/effects', 'galaxy');
      } catch (e) {}
      if (gal) dressed = buildDressed(systemId);
    }
    if (!dressed) return drawVista(ctx, systemId + '_nebula', camX, camY, vw, vh, 0.03, 0.85);
    var ox = -(((camX * 0.03) % 400 + 400) % 400);
    var oy = -(((camY * 0.03) % 400 + 400) % 400);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(dressed.canvas, -200 + ox, -200 + oy, vw + 400, vh + 400);
    ctx.restore();
    SF.BG._noteDraw(systemId + '_nebula');
    return true;
  }

  function gameState() {
    try {
      if (window.SF && SF.Game && typeof SF.Game.state === 'string') return SF.Game.state;
    } catch (e) {}
    return null;
  }

  function playerPos() {
    try {
      if (window.SF && SF.Player &&
          typeof SF.Player.x === 'number' && typeof SF.Player.y === 'number') {
        return { x: SF.Player.x, y: SF.Player.y };
      }
    } catch (e) {}
    return null;
  }

  /* Which single context vista (if any) owns the backdrop this frame.
   * Priority: dungeon > arena > anomaly > docked > dock approach.
   * All lookups are lazy so script load order never matters; every branch
   * is guarded so a missing module just yields no vista (procedural stays). */
  function vistaContext(systemId) {
    var state = gameState();
    if (state === 'DOCKED') return 'station_vista';
    var p = playerPos();
    if (!p) return null;
    var i, dx, dy;
    // the Hollow Cathedral dungeon (SF.DUNGEONS, secrets2.js)
    try {
      if (window.SF && SF.DUNGEONS) {
        for (i = 0; i < SF.DUNGEONS.length; i++) {
          var dg = SF.DUNGEONS[i];
          if (dg.systemId !== systemId) continue;
          dx = p.x - dg.x; dy = p.y - dg.y;
          if (dx * dx + dy * dy < DUNGEON_R * DUNGEON_R) return 'hollow_cathedral_backdrop';
        }
      }
    } catch (e) {}
    // combat arena gauntlet (SF.Arena, station.js)
    try {
      if (window.SF && SF.Arena && SF.Arena.active && SF.Arena.active()) {
        return 'arena_drift_vista';
      }
    } catch (e) {}
    // deep-space anomaly (SF.ANOMALY, secrets.js)
    try {
      if (window.SF && SF.ANOMALY && SF.ANOMALY.systemId === systemId) {
        dx = p.x - SF.ANOMALY.x; dy = p.y - SF.ANOMALY.y;
        if (dx * dx + dy * dy < ANOMALY_R * ANOMALY_R) return 'void_anomaly_deep';
      }
    } catch (e) {}
    // dock approach: inside the station prompt radius
    try {
      if (window.SF && SF.Station && SF.Station.nearStation &&
          SF.Station.nearStation(p, systemId)) {
        return systemId === 'solace' ? 'solace_docks_vista' : 'station_vista';
      }
    } catch (e) {}
    return null;
  }

  return {
    /* ---- quality ---- */

    init: function () {
      try {
        var q = localStorage.getItem(QKEY);
        if (q === 'auto' || q === 'high' || q === 'low') setting = q;
      } catch (e) {}
      resolve();
      buildNebula('solace');
      curSystem = 'solace';
      // backgrounds-wiring: warm the vista cache so zone visits don't pop
      SF.BG.preload(VISTA_NAMES);
      // b3-environment: warm the galaxy sprite so the first dressed
      // nebula build already includes it (buildDressed also rebuilds
      // once if the sprite arrives late).
      try {
        if (window.SF && SF.Sprites) SF.Sprites.preload('fx/effects', ['galaxy']);
      } catch (e) {}
      initialized = true;
    },

    getSetting: function () { return setting; },
    getEffective: function () { return effective; },

    setQuality: function (q) {
      if (q !== 'auto' && q !== 'high' && q !== 'low' && q !== 's25') return;
      setting = q;
      try { localStorage.setItem(QKEY, q); } catch (e) {}
      resolve();
    },

    cycle: function () {
      this.setQuality(setting === 'auto' ? 'high' : (setting === 'high' ? 'low' : 'auto'));
    },

    /* Starfield layer count for main.js: Low = 1 plane, s25 = 2 planes
     * (far + mid; the near twinkle plane is dropped), High = 3 planes. */
    starLayers: function () {
      return effective === 'low' ? 1 : (effective === 's25' ? 2 : 3);
    },

    /* b-perf: shared view-culling helpers (see viewRect above). */
    viewRect: viewRect,
    rectVisible: rectVisible,
    isS25: function () { return effective === 's25'; },

    nebulaReady: function () { return !!nebula; },
    nebulaOn: function () { return effective !== 'low' && !!nebula; },

    setSystem: function (systemId) {
      buildNebula(systemId);
      SF.BG.preload([systemId + '_nebula']);
      // backgrounds-wiring: jump flash on a real system change. enterSystem
      // calls this for newGame/continue/respawn/travelTo; only travelTo
      // (and starmap jumps) actually change the system, the rest are no-ops.
      if (initialized && systemId !== curSystem) {
        jumpFlash = JUMP_FLASH_T;
      }
      curSystem = systemId;
    },

    /* backgrounds-wiring: trigger the wormhole jump flash manually
     * (for the future wormhole phase; travelTo goes through setSystem). */
    jumpFlashNow: function () { jumpFlash = JUMP_FLASH_T; },

    /* ---- screen shake (trauma model) ---- */

    /* twelve-hour-wave2: shake discipline — at low hull (<30%) every shake
     * is scaled to 30% (a shake-on-damage loop that hides incoming fire is
     * worse than no shake), and a dead player shakes nothing. Callers keep
     * their magnitudes; this gate is the single choke point. */
    shake: function (mag) {
      mag = mag || 5;
      try {
        var pl = (window.SF && SF.Player) ? SF.Player : null;
        if (pl && !pl.alive) return;
        if (pl && typeof pl.hull === 'number' && typeof pl.maxHull === 'function') {
          var mh = pl.maxHull();
          if (mh > 0 && pl.hull / mh < 0.30) mag = mag * 0.3;
        }
      } catch (e) {}
      trauma = Math.min(1, trauma + mag / 16);
    },

    traumaLevel: function () { return trauma; },

    update: function (dt) {
      trauma = Math.max(0, trauma - dt * 1.8);
      if (jumpFlash > 0) jumpFlash = Math.max(0, jumpFlash - dt);
    },

    offset: function () {
      var s = trauma * trauma * 15;
      if (s < 0.2) return { x: 0, y: 0 };
      return { x: (Math.random() * 2 - 1) * s, y: (Math.random() * 2 - 1) * s };
    },

    /* ---- final-kill slow-mo finisher (final-kill-slowmo-retry) ---- */

    /* startFinisher(x, y): trigger the 1.2s cinematic beat on a boss/elite
     * kill at world (x, y). Gating (PLAYING only, boss/elite only, player
     * >= 25% hull) lives in the SF.Finisher hook in main.js; this just runs
     * the beat. Restarting mid-beat re-arms it on the new kill point. */
    startFinisher: function (x, y) {
      finKX = x; finKY = y;
      var p = null;
      try {
        if (window.SF && SF.Player &&
            typeof SF.Player.x === 'number' && typeof SF.Player.y === 'number') {
          p = SF.Player;
        }
      } catch (e) {}
      finSX = p ? p.x : x;
      finSY = p ? p.y : y;
      finT = 0;
      finActive = true;
    },

    /* Real-time clock; main.js's frame() calls this with unscaled dt. */
    updateFinisher: function (dt) {
      if (!finActive) return;
      finT += dt;
      if (finT >= FIN_T1 + FIN_T2) { finActive = false; finT = 0; }
    },

    /* Game-speed multiplier the main loop applies to its accumulator. */
    timeScale: function () {
      if (!finActive) return 1;
      if (finT < FIN_T1) return 0.25;
      return 0.25 + 0.75 * smooth((finT - FIN_T1) / FIN_T2);
    },

    finisherActive: function () { return finActive; },

    /* Camera zoom factor during the beat: eases 1 -> 1.6 over the slow-mo
     * hold, then relaxes back to 1 over the ease-out. */
    finisherZoom: function () {
      if (!finActive) return 1;
      if (finT < FIN_T1) return 1 + (FIN_ZOOM - 1) * easeOutCubic(finT / FIN_T1);
      return FIN_ZOOM - (FIN_ZOOM - 1) * smooth((finT - FIN_T1) / FIN_T2);
    },

    /* Camera focus: pans from the trigger position to the kill point over
     * the slow-mo beat (world coords). */
    finisherFocus: function () {
      if (!finActive) return { x: finKX, y: finKY };
      var k = finT < FIN_T1 ? easeOutCubic(finT / FIN_T1) : 1;
      return { x: finSX + (finKX - finSX) * k, y: finSY + (finKY - finSY) * k };
    },

    /* Desaturation-flash strength 0..1; main.js paints it in screen space
     * via drawFinisherFlash(). */
    finisherFlash: function () {
      if (!finActive || finT >= FLASH_T) return 0;
      return 0.38 * (1 - finT / FLASH_T);
    },

    /* Paint the desaturation flash: a gray wash under the 'saturation'
     * composite flattens the scene's saturation by the flash alpha (true
     * desaturation, not a white overlay). No-op when idle. */
    drawFinisherFlash: function (ctx, vw, vh) {
      var a = this.finisherFlash();
      if (a <= 0.003) return;
      ctx.save();
      try { ctx.globalCompositeOperation = 'saturation'; } catch (e) {}
      ctx.fillStyle = 'rgba(128,128,128,' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    },

    /* smoke-test introspection */
    finisherState: function () {
      return { active: finActive, t: finT,
               timeScale: this.timeScale(), zoom: this.finisherZoom() };
    },

    /* ---- floating damage numbers (damage-numbers-retry, wired b2) ----
     * See the b2-combat-feedback block above the pool for wiring, cap,
     * aggregation, and toggle notes. Save-neutral: runtime-only pool. */

    /* Spawn a floating damage number at world (x, y).
     * amount: numeric (rounded; heal shows as '+N'). Zero/NaN spawns nothing.
     * opts: {type:'dealt'|'yellow'|'crit'|'taken'|'heal', crit:bool,
     *        color:'#..', size:px, key:string}. key enables aggregation:
     * same-key hits within AGG_WINDOW merge into one running total.
     * Engine note (twelve-hour-wave2): the crit flag IS now propagated —
     * ship.js fire passes crit through the projectile pool (projectiles.js
     * p.crit) and main.js collisions() hands it to enemies.damage(), so
     * gunner-perk crits render orange + larger and feed the CombatFeed
     * CRIT line. Non-crit dealt numbers stay white, taken red, heal teal.
     * Low tier: 1-in-2 spawns dropped, 0.8x font. Pool full: dropped. */
    damageNumber: function (x, y, amount, opts) {
      if (!feedbackOn) return false;
      var n = Math.round(+amount);
      if (!isFinite(n) || n === 0) return false;
      opts = opts || {};
      var t = NUM_TYPES[opts.type] || NUM_TYPES.dealt;
      if (opts.crit) t = NUM_TYPES.crit;
      var size = opts.size || t.size;
      if (this.getEffective() === 'low') {
        // reduced rate on Low: drop every other number (round-robin)
        numDropToggle = !numDropToggle;
        if (numDropToggle) return false;
        size = Math.max(10, Math.round(size * 0.8));
      }
      var jx = x + (Math.random() - 0.5) * 14; // jitter so bursts fan out
      var jy = y - 6;
      var key = (typeof opts.key === 'string' && opts.key) ? opts.key : null;
      if (key) {
        var ent = numAgg[key];
        if (ent && ent.slot.active && ent.slot.aggKey === key &&
            (numTime - ent.t) <= AGG_WINDOW) {
          // merge: running total, life refreshed, position follows the hit
          // twelve-hour-wave2: a crit merging into a normal-hit slot
          // UPGRADES the slot to orange + larger (never downgrades a
          // crit slot on a later normal hit) so crits read even in a
          // rapid-fire stream that aggregates within 150 ms.
          if (opts.crit) { ent.slot.color = t.color; ent.slot.size = t.size; }
          ent.total += n;
          ent.t = numTime;
          ent.slot.total = ent.total;
          ent.slot.text = ((opts.type === 'heal') ? '+' : '') + ent.total;
          ent.slot.life = NUM_LIFE;
          ent.slot.x = jx;
          ent.slot.y = jy;
          return true;
        }
      }
      var p = numClaim();
      if (!p) return false;
      p.active = true;
      p.x = jx;
      p.y = jy;
      p.vx = (Math.random() - 0.5) * 22;
      p.vy = -NUM_RISE * (0.85 + Math.random() * 0.3);
      p.life = NUM_LIFE;
      p.text = ((opts.type === 'heal') ? '+' : '') + n;
      p.color = opts.color || t.color;
      p.size = size;
      p.total = n;
      p.aggKey = key;
      if (key) {
        if (!numAgg[key]) numAggCount++;
        numAgg[key] = { slot: p, total: n, t: numTime };
      }
      return true;
    },

    /* Per-frame clock. Called from main.js's frame() with the same dt it
     * passes to SF.FX.update. Also advances the aggregation clock and
     * retires aggregation entries whose slot expired. */
    updateNumbers: function (dt) {
      numTime += dt;
      for (var i = 0; i < NUM_POOL; i++) {
        var p = numPool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          if (p.aggKey && numAgg[p.aggKey] && numAgg[p.aggKey].slot === p) {
            delete numAgg[p.aggKey];
            numAggCount--;
          }
          p.aggKey = null;
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx -= p.vx * 1.8 * dt;  // ease to a straight vertical rise
      }
    },

    /* Programmatic combat-feedback toggle (no settings-UI surface exists;
     * default ON). Device preference only — never touches the save blob. */
    setCombatFeedback: function (on) {
      feedbackOn = !!on;
      try { localStorage.setItem(FB_KEY, feedbackOn ? '1' : '0'); } catch (e) {}
    },

    combatFeedbackOn: function () { return feedbackOn; },

    /* Batched world-space draw: one font/fill/stroke state per
     * (color,size) bucket, then one fillText+strokeText per number.
     * Call from main.js render() after SF.Particles.draw(ctx). */
    drawNumbers: function (ctx) {
      var buckets = {};
      var keys = [];
      var i, p, k;
      for (i = 0; i < NUM_POOL; i++) {
        p = numPool[i];
        if (!p.active) continue;
        k = p.color + '|' + p.size;
        if (!buckets[k]) { buckets[k] = []; keys.push(k); }
        buckets[k].push(p);
      }
      if (!keys.length) return;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (i = 0; i < keys.length; i++) {
        var arr = buckets[keys[i]];
        ctx.font = NUM_FONT.replace('{s}', String(arr[0].size));
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.fillStyle = arr[0].color;
        for (var j = 0; j < arr.length; j++) {
          p = arr[j];
          // fade the last 40% of life; rise speed is eased in update()
          ctx.globalAlpha = p.life < NUM_LIFE * 0.4 ? p.life / (NUM_LIFE * 0.4) : 1;
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillText(p.text, p.x, p.y);
        }
      }
      ctx.restore();
    },

    /* smoke-test introspection: live items [{x,y,text,color,size}]. */
    _numItems: function () {
      var out = [];
      for (var i = 0; i < NUM_POOL; i++) {
        var p = numPool[i];
        if (p.active) out.push({ x: p.x, y: p.y, text: p.text,
                                 color: p.color, size: p.size,
                                 key: p.aggKey, total: p.total });
      }
      return out;
    },

    /* b2 smoke-test hook: pool/aggregation state. */
    _numState: function () {
      var live = 0;
      for (var i = 0; i < NUM_POOL; i++) if (numPool[i].active) live++;
      return { live: live, pool: NUM_POOL, aggWindow: AGG_WINDOW,
               aggEntries: numAggCount, time: +numTime.toFixed(3),
               feedbackOn: feedbackOn };
    },

    /* smoke-test hook: clear the pool (and the Low-tier drop toggle). */
    _resetNumbers: function () {
      for (var i = 0; i < NUM_POOL; i++) {
        numPool[i].active = false;
        numPool[i].aggKey = null;
      }
      numAgg = {};
      numAggCount = 0;
      numDropToggle = false;
    },

    /* ---- nebula background (screen space, slow parallax) ----
     * High tier: deepfield base -> procedural nebula -> per-system webp
     * nebula -> ember overlay -> one context vista -> jump flash.
     * Low tier: procedural only (unchanged legacy path). */

    drawNebula: function (ctx, camX, camY, vw, vh) {
      if (effective === 'low' || !nebula) return;
      var systemId = curSystem;
      try {
        if (window.SF && SF.Game && typeof SF.Game.systemId === 'string') {
          systemId = SF.Game.systemId;
        }
      } catch (e) {}

      // 1. deepfield far base (near-black; procedural shows through the gaps)
      drawVista(ctx, 'deepfield', camX, camY, vw, vh, 0.012, 1);

      // 2. procedural nebula (legacy layer, always the fallback)
      var ox = -(((camX * 0.03) % 400 + 400) % 400);
      var oy = -(((camY * 0.03) % 400 + 400) % 400);
      ctx.drawImage(nebula.canvas, -200 + ox, -200 + oy, vw + 400, vh + 400);

      // 3. per-system webp nebula over the procedural one
      // b3-environment: region-tinted + galaxy-baked variant, 1-for-1
      // (same call count as the raw drawVista it replaces).
      drawDressedNebula(ctx, systemId, camX, camY, vw, vh);

      // 4. ember approach overlay while in the Ember system
      if (systemId === 'ember') {
        drawVista(ctx, 'ember_surface_vista', camX, camY, vw, vh, 0.02, 0.5);
      }

      // 5. one context vista (dungeon > arena > anomaly > docked > approach)
      var v = vistaContext(systemId);
      if (v) drawVista(ctx, v, camX, camY, vw, vh, 0.02, 0.9);

      // 6. wormhole jump flash, fading
      if (jumpFlash > 0) {
        drawVista(ctx, 'wormhole_vista', camX, camY, vw, vh, 0,
          Math.min(1, jumpFlash / JUMP_FLASH_T * 1.6));
      }
    },

    /* backgrounds-wiring: TITLE-screen vista. main.js's TITLE branch never
     * calls into SF.FX (out of scope for this phase); one line there wires it:
     *   SF.FX.drawTitleVista(ctx, vw, vh);
     * Low tier draws nothing (procedural starfield stays). */
    /* b3-environment: TITLE-screen vista, cover-fit (not stretched).
     * The previous version stretched the 2048px square art to vw x vh,
     * which distorts it on wide (915x412) and portrait viewports.
     * Cover-fit crops the long axis instead, so the art reads the same
     * everywhere. Still 1 drawImage, still skipped on Low tier and while
     * loading (caller keeps the procedural starfield as fallback). */
    drawTitleVista: function (ctx, vw, vh) {
      if (effective === 'low') return;
      var img = SF.BG.get('title_nebula');
      if (!img) return;
      ctx.save();
      if (img.naturalWidth && img.naturalHeight) {
        var s = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
        var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
        ctx.drawImage(img, (vw - dw) / 2, (vh - dh) / 2, dw, dh);
      } else {
        ctx.drawImage(img, 0, 0, vw, vh);
      }
      ctx.restore();
      SF.BG._noteDraw('title_nebula');
    },

    /* ---- smoke-test hooks (backgrounds-wiring) ---- */

    /* {vistaName: drawImage count} since the last reset — proves each zone
     * drew its vista at least once. */
    vistaDraws: function () { return SF.BG.drawStats(); },
    // b3-environment: which dressed nebula is baked (test hook).
    dressedNebulaInfo: function () {
      return dressed ? { systemId: dressed.systemId, withGalaxy: dressed.withGalaxy } : null;
    },
    vistaResetDraws: function () { SF.BG.resetDraws(); }
  };
})();

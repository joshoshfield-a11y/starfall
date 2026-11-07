/* STARFALL Phase 1 — enemies.js
 * 3 enemy types with simple AI: drone (chaser), raider (strafe + shoot), gunship (tank + missiles).
 * States: 'chase' | 'strafe' | 'flee' (flee when hp < fleeHpFrac).
 */
window.SF = window.SF || {};

SF.Enemies = (function () {
  var list = [];
  var dmgSeq = 0; // b2-combat-feedback: per-enemy aggregation keys

  /* ================= elite-enrage-phases (2026-10-21) =================
 * SF.ENRAGE: elites and bosses ENRAGE at <=30% hull, once per fight
 * (e.enraged latch). Effect: fire interval x0.65 (+35% fire rate),
 * speed x1.2 (+20%), red pulsing aura (SF.Particles.burst runtime calls
 * + a canvas ring in draw()). Bosses additionally shorten telegraph
 * windups x0.8. Runtime-only, save-neutral: flags live on the entity and
 * die with it, so a respawned ship spawns calm — no SAVE_VERSION bump.
 */
window.SF = window.SF || {};
SF.ENRAGE = {
  HULL_FRAC: 0.30, // hull fraction at/below which enrage triggers
  FIRE_MUL: 0.65,  // +35% fire rate: fire interval x0.65
  SPEED_MUL: 1.20, // +20% speed
  WINDUP_MUL: 0.80 // bosses: telegraph windups 20% shorter
};

/* Enrage trigger — called from SF.Enemies.damage after the hull drops.
 * Guards (e.hp > 0, !e.enraged, elite-or-boss, hp/maxHp <= 0.30) are at the
 * call site; this applies the multipliers exactly once per fight. */
function triggerEnrage(e) {
  e.enraged = true;    // once-per-fight latch
  e.enrageAura = true; // draw() renders the red pulsing aura + tag
  if (e.boss) {
    // bosses: attack loop reads e.enraged directly (cooldown x0.65 in
    // updateBoss, windup x0.8 in startAttack); speed via bossSpeedMul
    e.bossSpeedMul = (e.bossSpeedMul || 1) * SF.ENRAGE.SPEED_MUL;
  } else {
    // elites: per-enemy fire interval x0.65, speed x1.2. fireTimer keeps
    // its current countdown; only the interval shortens (by design).
    e.fireInterval = (e.fireInterval || e.spec.fireInterval || 0) *
      SF.ENRAGE.FIRE_MUL;
    e.speedMul = (e.speedMul || 1) * SF.ENRAGE.SPEED_MUL;
  }
  var label = (e.boss && e.bossDef && e.bossDef.title) ||
    e.eliteName || (e.boss ? 'BOSS' : 'ELITE');
  if (window.SF && SF.HUD) SF.HUD.toast('\u{1F525} ' + label + ' ENRAGED!');
  if (window.SF && SF.Particles)
    SF.Particles.burst(e.x, e.y, '#ff2a2a', 14, 260, 0.6, 4);
}

/* Enraged aura puffs — red pulse via the existing particles.js burst API
 * (runtime calls only; particles.js is not edited). Shared by the normal
 * update loop, pattern enemies, raid enemies, and boss update. */
function emitEnrageAura(e, dt) {
  if (!e.enraged) return;
  e.enragePuffT = (e.enragePuffT || 0) - dt;
  if (e.enragePuffT <= 0 && window.SF && SF.Particles) {
    e.enragePuffT = 0.25;
    SF.Particles.burst(e.x, e.y, '#ff2a2a', 2, 110, 0.35, 3);
  }
}

/* ================= treaty-provocation (2026-10-21) =================
   * Who-shot-first provocation model feeding treaty pact decay.
   * e.provoked is true when the ship was hostile to the player BEFORE the
   * player damaged it (spawned hostile / fired first / interdicted).
   * kill() hands the verdict to SF.Treaties.onKill through the
   * __provokedKillOf handoff; the wrap below makes
   * SF.Treaties.onKill(fid, {provoked}) skip pact decay for provoked kills.
   * Everything is guarded: if the treaties phase is absent or merges later,
   * the wrap installs lazily and never throws. Standing/karma consequences
   * in Factions.act are untouched — only pact decay is gated. Save-neutral:
   * provocation is runtime-only (never serialized, no save bump).
   */
  function installTreatyProvocationWrap() {
    try {
      if (!window.SF || !SF.Treaties || !SF.Treaties.onKill) return false;
      if (SF.Treaties.onKill.__provoked) return true; // already wrapped
      var orig = SF.Treaties.onKill;
      SF.Treaties.onKill = function (fid, opts) {
        var prov = !!(opts && opts.provoked);
        try {
          if (!prov && window.SF && SF.Enemies &&
              SF.Enemies.__provokedKillOf === fid) prov = true;
        } catch (e2) { /* never let the guard break the kill path */ }
        if (prov) return; // provoked kill: the pact stands
        return orig.call(this, fid);
      };
      SF.Treaties.onKill.__provoked = true;
      return true;
    } catch (e) { return false; }
  }

  /* sprite-wiring-enemies (2026-10-19): file-backed enemy sprites.
   * Loader key per enemy, from the phases/enemy-sprites-1 REPORT wiring hook:
   *   sid = type + (faction ? '_' + faction : '') + (elite ? '_' + elite : '')
   * SF.Sprites.get('enemies', sid) returns the cached Image or null while
   * loading / on 404 — the caller ALWAYS keeps its procedural draw as
   * the fallback. Sprites are nose-up, like the ship sprites; the game
   * rotates e.angle when drawing, which maps sprite-up to facing.
   */
  var ENEMY_SPRITE_IDS = [
    'drone', 'raider', 'gunship', 'freighter',
    'raider_compact', 'raider_drifters', 'raider_ember',
    'gunship_compact', 'gunship_drifters', 'gunship_ember',
    'drone_fast', 'drone_bulwark', 'drone_swarmlord',
    'raider_fast', 'raider_bulwark', 'raider_swarmlord',
    'gunship_fast', 'gunship_bulwark', 'gunship_swarmlord',
    'boss_solace', 'boss_drift', 'boss_ember'
  ];
  var spritesPreloaded = false;

  function enemySpriteId(e) {
    return e.type + (e.faction ? '_' + e.faction : '') +
      (e.elite ? '_' + e.elite : '');
  }

  function preloadEnemySprites() {
    if (spritesPreloaded) return;
    if (window.SF && SF.Sprites) SF.Sprites.preload('enemies', ENEMY_SPRITE_IDS);
    preloadFactionSprites();
    spritesPreloaded = true;
  }

  /* b4-sprite-lighting: sprite-preserving hit flash (Enemies IIFE copy —
   * the Bosses IIFE below carries its own copy; the two IIFEs share no
   * scope. Same contract: cached white silhouette of the exact sprite,
   * loader-null still falls back to the procedural hull). */
  var whiteCache = {};
  function whiteSilhouette(img) {
    var key = img.src || '';
    if (whiteCache[key]) return whiteCache[key];
    var w = img.naturalWidth || img.width || 64,
        h = img.naturalHeight || img.height || 64;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    whiteCache[key] = c;
    return c;
  }

  /* v2-faction-ships-wiring (2026-10-20): faction-class sprites.
   * Faction patrols, elites and neutral traders fly v2 faction ships
   * (assets/sprites/factions/<id>.png via SF.Sprites.get('factions', id);
   * full manifest tools/v2-sprite-manifest.json). The art is nose-up and
   * rotates into the nose-+X frame exactly like the player hull
   * (angle + PI/2, the SF.Ship.drawSpriteHull convention). The older
   * 'enemies'-kind sprites and the procedural hulls stay as the
   * loading/404 fallback — a null return always means "draw fallback".
   *
   * Art-faction assignment: Compact -> Terran, Drifters -> Zeta,
   * Ember Pact -> Xal'thar; elites fly Kra'thul (reads hostile).
   */
  var FACTION_ART = { compact: 'terran', drifters: 'zeta', ember: 'xalthar' };
  var FACTION_SPRITE_BY_CLASS = {
    terran:  { drone: 'terran-shuttle',   raider: 'terran-starship',
               gunship: 'terran-bomber',  freighter: 'terran-transport' },
    zeta:    { drone: 'zeta-starship',    raider: 'zeta-starship',
               gunship: 'zeta-destroyer', freighter: 'zeta-carrier' },
    xalthar: { drone: 'xalthar-starship', raider: 'xalthar-starship',
               gunship: 'xalthar-battleship', freighter: 'xalthar-carrier' },
    krathul: { fast: 'krathul-destroyer', bulwark: 'krathul-battleship',
               swarmlord: 'krathul-mothership' }
  };
  var FACTION_SPRITE_IDS = [];
  (function () {
    var seen = {};
    function add(id) { if (id && !seen[id]) { seen[id] = true; FACTION_SPRITE_IDS.push(id); } }
    var k, c, m;
    for (k in FACTION_SPRITE_BY_CLASS) {
      m = FACTION_SPRITE_BY_CLASS[k];
      for (c in m) add(m[c]);
    }
    add('terran-transport'); // neutral convoy freighters
  })();

  // Loader key for an enemy's faction-class sprite, or null when this
  // enemy has no faction assignment (plain pirates keep 'enemies' sprites).
  function factionSpriteId(e) {
    if (e.elite) {
      var em = FACTION_SPRITE_BY_CLASS.krathul;
      return em[e.elite] || null;
    }
    if (e.faction) {
      var art = FACTION_ART[e.faction];
      var fm = art && FACTION_SPRITE_BY_CLASS[art];
      return (fm && fm[e.type]) || null;
    }
    if (e.trader && e.type === 'freighter') return 'terran-transport';
    return null;
  }

  function preloadFactionSprites() {
    if (window.SF && SF.Sprites) SF.Sprites.preload('factions', FACTION_SPRITE_IDS);
  }

  // Non-boss enemy hull half-width on the sprite canvas vs collision radius:
  // sprite canvases are 256px nose-up; draw at 2.2x collision radius so the
  // sprite hull reads about the same size as the old procedural hulls.
  var SPRITE_SCALE = 2.2;

  /* ================= enemy-ai-patterns (2026-10-20) =================
   * Pattern registry: named behaviors assigned via SF.Enemies.spawn(..,
   * {pattern: 'kamikaze'|'weaver'|'sniper'}). Patterns run in
   * SF.Enemies.update INSTEAD of the default chase/strafe AI. Flee, raid,
   * trader, friendly-stand-down and boss paths still take precedence, and
   * neutral faction patrols only fly patterns once provoked (standing
   * consequences stay legible). All state lives on e.pat (runtime-only,
   * save-neutral — no save bump).
   *
   *   kamikaze: 0.6s telegraph (brakes, warns, aims at the player), then a
   *     full-bore ramming run. Detonates on contact or when shot down —
   *     area blast around the wreck (see kill()).
   *   weaver: sine-strafe approach — perpendicular sine offset while
   *     closing, orbit-plus-sine inside range. Keeps the normal gun.
   *   sniper: backs off to / holds a 440–580 preferred band, then a 1.2s
   *     beam telegraph on a locked line, then one heavy beam bolt.
   */
  SF.ENEMY_PATTERNS = {
    kamikaze: { telegraph: 0.6, runSpeedMul: 1.7, blastRadius: 130, blastDmgMul: 1.6 },
    weaver:   { sineFreq: 3.0, sineAmp: 0.85, orbitWant: 300 },
    sniper:   { holdMin: 440, holdMax: 580, telegraph: 1.2, beamDmgMul: 3.0, cooldown: 4.0 }
  };

  function patternWilling(e) {
    // faction patrols fly patterns only when hostile or provoked
    if (e.faction && window.SF && SF.Factions && !e.playerAggro &&
        SF.Factions.stance(e.faction) === 'neutral') return false;
    return true;
  }

  function updatePatternEnemy(e, dt, player, worldSize) {
    emitEnrageAura(e, dt); // elite-enrage-phases: pulsing red aura while enraged
    var P = SF.ENEMY_PATTERNS[e.pattern];
    var dx = player.x - e.x, dy = player.y - e.y;
    var dist = Math.hypot(dx, dy) || 1;
    var nx = dx / dist, ny = dy / dist;
    var sp = e.spec.speed * (e.speedMul || 1);
    if (!e.pat) e.pat = { phase: 'start', t: 0, ang: 0, wob: Math.random() * 6.28 };
    var ax = 0, ay = 0;
    if (e.pattern === 'kamikaze') {
      if (e.pat.phase === 'start') { e.pat.phase = 'telegraph'; e.pat.t = P.telegraph; }
      if (e.pat.phase === 'telegraph') {
        // telegraph: brake to a crawl, warn, keep the aim line on the player
        e.pat.t -= dt;
        var damp = Math.max(0, 1 - 4 * dt);
        e.vx *= damp; e.vy *= damp;
        e.pat.ang = Math.atan2(dy, dx);
        if (e.pat.t <= 0) {
          e.pat.phase = 'run';
          if (window.SF && SF.HUD) SF.HUD.toast('\u26a0 KAMIKAZE INBOUND!');
        }
      } else { // run: full-bore ramming vector at the player's live position
        var rsp = sp * P.runSpeedMul;
        ax = nx * rsp; ay = ny * rsp;
      }
    } else if (e.pattern === 'weaver') {
      e.pat.wob += dt * P.sineFreq;
      var wobA = Math.sin(e.pat.wob) * P.sineAmp * sp;
      if (dist > P.orbitWant) {
        ax = nx * sp + (-ny) * wobA; ay = ny * sp + nx * wobA;
      } else { // inside range: orbit with the sine riding on top
        var radial = dist > P.orbitWant + 40 ? 0.5 :
          (dist < P.orbitWant - 40 ? -0.5 : 0);
        ax = (-ny * e.strafeDir + nx * radial) * sp + (-ny) * wobA * 0.6;
        ay = (nx * e.strafeDir + ny * radial) * sp + nx * wobA * 0.6;
      }
    } else if (e.pattern === 'sniper') {
      if (e.pat.phase === 'start') { e.pat.phase = 'hold'; e.pat.t = 0; }
      // enemy-ai-tactics-2: SNIPER KITING coordination — the sniper holds a
      // long-range standoff (~1800px, outside most return fire) instead of
      // the old 440-580 close band. When the player closes inside the
      // bubble it retreats along a visible retreat vector (e.kiteVec, drawn
      // dashed in draw()) and any in-progress beam lock is broken — the
      // lock must be re-acquired at standoff range.
      var K = SF.TACTICS.sniper;
      var kiting = dist < K.standoff - K.band;
      if (kiting) {
        e.kiteVec = { x: -nx, y: -ny }; // retreat vector (test hook + draw)
        ax = -nx * sp * K.retreatMul; ay = -ny * sp * K.retreatMul;
        if (e.pat.phase === 'lock') { e.pat.phase = 'hold'; e.pat.t = 1.0; }
      } else {
        e.kiteVec = null;
        if (e.pat.phase === 'hold') {
          // hold the standoff band; drift gently back into it
          var rad2 = dist > K.standoff + K.band ? 0.7 :
            (dist < K.standoff - K.band ? -0.7 : 0);
          ax = nx * rad2 * sp * 0.6; ay = ny * rad2 * sp * 0.6;
          e.pat.t -= dt;
          if (dist < K.lockRange && e.pat.t <= 0) {
            e.pat.phase = 'lock'; e.pat.t = P.telegraph;
            e.pat.ang = Math.atan2(dy, dx); // beam line locks here
          }
        } else { // lock: hold position, beam telegraph on the locked line
          var ldp = Math.max(0, 1 - 4 * dt);
          e.vx *= ldp; e.vy *= ldp;
          e.pat.t -= dt;
          if (e.pat.t <= 0) {
            // treaty-provocation: fired before the player ever damaged it
            if (e.faction && !e.playerAggro) e.provoked = true;
            var bsp = e.spec.boltSpeed || 520;
            // tactics-2: the beam must connect at standoff range — extend
            // the bolt's life so it travels at least dist + margin.
            var beamLife = Math.max(2.2, dist / (bsp * 1.6) + 0.5);
            SF.Projectiles.spawn(e.x, e.y, e.pat.ang, bsp * 1.6,
              e.spec.boltDamage * (e.dmgMul || 1) * P.beamDmgMul, false,
              '#b8f4ff', { radius: 5, life: beamLife });
            SF.Audio.enemyLaser();
            e.pat.phase = 'hold'; e.pat.t = P.cooldown;
          }
        }
      }
    }
    var k = Math.min(1, 3 * dt);
    e.vx += (ax - e.vx) * k; e.vy += (ay - e.vy) * k;
    e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
    e.angle = Math.atan2(e.vy, e.vx);
    // weaver keeps the normal gun; kamikaze never fires; sniper fires the beam
    if (e.pattern === 'weaver' && e.spec.fireInterval && dist < 700) {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        // treaty-provocation: fired before the player ever damaged it
        if (e.faction && !e.playerAggro) e.provoked = true;
        e.fireTimer = (e.fireInterval || e.spec.fireInterval) * (0.85 + Math.random() * 0.3);
        var a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.12;
        SF.Projectiles.spawn(e.x, e.y, a, e.spec.boltSpeed,
          e.spec.boltDamage * (e.dmgMul || 1), false, '#ff9d5e',
          { radius: 4, life: 3.5 });
        SF.Audio.enemyLaser();
      }
    }
    // contact damage — kamikaze detonates on a completed run
    if (dist < e.radius + player.radius && e.contactTimer <= 0) {
      e.contactTimer = SF.CONFIG.player.contactCooldown;
      if (e.pattern === 'kamikaze' && e.pat.phase === 'run') {
        SF.Enemies.damage(e, e.hp); // detonate (AoE handled in kill())
      } else {
        player.takeDamage(e.spec.contact);
      }
    }
  }

  /* ================= enemy-ai-tactics-2 (2026-10-21) =================
   * COORDINATED GROUP TACTICS layered on top of the individual AI behaviors.
   * Additive only — no refactors of the chase/strafe core, the raid AI, or
   * the enemy-ai-patterns behaviors (kamikaze/weaver/sniper INDIVIDUAL
   * logic stays intact; only coordination is added around it).
   * Runtime-only, save-neutral: all state lives on the entity
   * (e.flankSlot/e.flankPing, e.kiteVec, e.carrier/e.carrierOf) and dies
   * with it — no SAVE_VERSION bump.
   *
   *   (1) PACK FLANKING: 3+ raiders targeting the player split into arc
   *       sectors (port / starboard / astern of the pack's approach bearing)
   *       instead of clustering. Assignment is deterministic per tick
   *       (sorted by angle around the player, round-robin); a sector change
   *       fires a subtle expanding-ring formation ping (draw()).
   *   (2) SNIPER KITING: sniper-pattern enemies hold an ~1800px standoff
   *       instead of closing to the old 440-580 band. When the player closes
   *       inside the bubble they retreat along a visible retreat vector
   *       (e.kiteVec, drawn dashed in draw()) and must re-acquire the beam
   *       lock at range. The beam bolt's life is extended so it still
   *       connects at standoff distance.
   *   (3) CARRIER LAUNCH: gunship-class enemies carry a drone bay. Every few
   *       seconds they launch 1-2 drone escorts (cap 4 live per carrier);
   *       the escorts are tagged (e.carrierOf) and despawn with the carrier.
   */
  SF.TACTICS = {
    flank: {
      minPack: 3,      // raiders needed to form a pack
      packRange: 900,  // raiders within this of the player may join a pack
      orbitR: 300,     // arc-sector slot radius around the player
      steerW: 0.55,    // blend weight: sector-slot vs default AI steering
      pingT: 0.6       // formation-change ping ring lifetime (seconds)
    },
    sniper: {
      standoff: 1800,  // preferred range from the player
      band: 150,       // hold tolerance around the standoff
      lockRange: 1900, // beam lock may start under this range
      retreatMul: 1.1  // retreat speed multiplier when the player closes
    },
    carrier: {
      cap: 4,          // max live drones per carrier
      min: 1, max: 2,  // drones per launch event
      interval: [6, 10], // seconds between launch events
      launchR: 70      // spawn offset from the carrier hull
    }
  };

  /* Pack-flanking pre-pass — runs at the top of SF.Enemies.update, before
   * the per-enemy AI loop. Groups 3+ raiders that are actively targeting the
   * player into arc sectors around the player. Sets e.flankSlot
   * ({idx, ang}) for steering (consumed in the default-AI chase/strafe
   * branches) and e.flankPing when a raider's sector changes. Raiders that
   * are not in a pack get flankSlot = null (default AI runs untouched). */
  function tacticsPackPass(dt, player) {
    var F = SF.TACTICS.flank;
    var pack = [], i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.flankPing > 0) e.flankPing -= dt;
      if (e.type !== 'raider' || e.pattern || e.boss || e.adrift ||
          e.trader || e.hp <= 0) { e.flankSlot = null; continue; }
      // fleeing raiders break formation
      if (e.hp < e.maxHp * SF.CONFIG.fleeHpFrac) { e.flankSlot = null; continue; }
      // only raiders near the fight can join the pack
      if (Math.hypot(e.x - player.x, e.y - player.y) > F.packRange) {
        e.flankSlot = null; continue;
      }
      // neutral patrols that haven't been provoked don't join the pack
      try {
        if (e.faction && window.SF && SF.Factions && !e.playerAggro &&
            SF.Factions.stance(e.faction) === 'neutral') {
          e.flankSlot = null; continue;
        }
      } catch (x) { /* factions unavailable in this harness */ }
      pack.push(e);
    }
    if (pack.length < F.minPack) {
      for (i = 0; i < pack.length; i++) pack[i].flankSlot = null;
      return; // no pack: every candidate already cleared above
    }
    // approach bearing: pack centroid -> player. Sectors: port (+90),
    // starboard (-90), astern (+180) of the approach — left, right, behind.
    var cx = 0, cy = 0;
    for (i = 0; i < pack.length; i++) { cx += pack[i].x; cy += pack[i].y; }
    cx /= pack.length; cy /= pack.length;
    var th0 = Math.atan2(cy - player.y, cx - player.x);
    var sectors = [th0 + Math.PI / 2, th0 - Math.PI / 2, th0 + Math.PI];
    // deterministic assignment: sort by angle around the player, round-robin
    pack.sort(function (a, b) {
      return Math.atan2(a.y - player.y, a.x - player.x) -
             Math.atan2(b.y - player.y, b.x - player.x);
    });
    for (i = 0; i < pack.length; i++) {
      e = pack[i];
      var idx = i % 3;
      e.flankSlot = { idx: idx, ang: sectors[idx] };
      if (e._flankIdx !== idx) e.flankPing = F.pingT; // formation change
      e._flankIdx = idx;
    }
  }

  /* Carrier launch pass — runs at the top of SF.Enemies.update. Gunship
   * carriers (e.carrier, initialized in spawn()) periodically launch 1-2
   * drone escorts, capped at SF.TACTICS.carrier.cap live drones each. Dead
   * drone refs are pruned every tick so the cap tracks LIVE drones. */
  function carrierPass(dt, player, worldSize) {
    var C = SF.TACTICS.carrier;
    var playing = !!(window.SF && SF.Game && SF.Game.state === 'PLAYING');
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.type !== 'gunship' || !e.carrier) continue;
      // prune dead drone refs
      var live = [];
      for (var d = 0; d < e.carrier.drones.length; d++) {
        if (list.indexOf(e.carrier.drones[d]) >= 0) live.push(e.carrier.drones[d]);
      }
      e.carrier.drones = live;
      if (!playing) continue;
      // dead-in-the-water or fleeing carriers don't launch
      if (e.adrift || e.empTimer > 0 || e.state === 'flee' || e.boss) continue;
      e.carrier.timer -= dt;
      if (e.carrier.timer > 0) continue;
      if (live.length >= C.cap) { e.carrier.timer = 1.0; continue; } // recheck soon
      var mul = 1;
      try {
        var sd = (window.SF && SF.SYSTEM_BY_ID &&
          SF.SYSTEM_BY_ID[SF.Game.systemId]);
        if (sd && sd.enemyMul) mul = sd.enemyMul;
      } catch (x) { /* harness: default mul */ }
      var n = C.min + Math.floor(Math.random() * (C.max - C.min + 1));
      n = Math.min(n, C.cap - live.length);
      for (var k = 0; k < n; k++) {
        var a = Math.random() * Math.PI * 2;
        var dr = SF.Enemies.spawn('drone',
          e.x + Math.cos(a) * (e.radius + C.launchR),
          e.y + Math.sin(a) * (e.radius + C.launchR),
          mul, {});
        dr.carrierOf = e; // despawns with the carrier (see kill())
        live.push(dr);
      }
      e.carrier.drones = live;
      if (window.SF && SF.Particles)
        SF.Particles.burst(e.x, e.y, '#b45cff', 8, 200, 0.5, 3);
      e.carrier.timer = C.interval[0] +
        Math.random() * (C.interval[1] - C.interval[0]);
    }
  }

  function pickType(table) {
    var total = 0, i;
    for (i = 0; i < table.length; i++) total += table[i][1];
    var r = Math.random() * total;
    for (i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return table[i][0];
    }
    return table[0][0];
  }

  var SYSTEM_FACTION = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  /* early-game-difficulty-1: THE rookie-grace factor — the one tunable
   * lever for early-game difficulty. Derived live from the pilot level
   * (SF.Skills.level(), an already-saved field) and SF.CONFIG.rookie;
   * runtime-only, never serialized. Returns
   *   { active, level, t, dmg, fireInt, contact }
   * where dmg/fireInt/contact are multipliers to APPLY on top of the
   * per-system difficulty scaling (dmg < 1 softens bolts, fireInt > 1
   * slows fire, contact < 1 softens ramming).
   * Outside the rookie system, or at/above fullLevel, this is the
   * identity factor { active:false, dmg:1, fireInt:1 }. */
  function rookieFactor(systemId) {
    var cfg = (window.SF && SF.CONFIG && SF.CONFIG.rookie) || null;
    var lvl = 1;
    try {
      if (window.SF && SF.Skills && SF.Skills.level) lvl = SF.Skills.level() | 0;
    } catch (x) { /* skills unavailable (harness) — treat as level 1 */ }
    if (!cfg || systemId !== cfg.systemId || lvl >= cfg.fullLevel) {
      return { active: false, level: lvl, t: 1, dmg: 1, fireInt: 1, contact: 1 };
    }
    var t = Math.max(0, Math.min(1, (lvl - 1) / Math.max(1, cfg.fullLevel - 1)));
    return {
      active: true, level: lvl, t: t,
      dmg: cfg.dmgAtStart + (1 - cfg.dmgAtStart) * t,
      fireInt: cfg.fireIntAtStart + (1 - cfg.fireIntAtStart) * t,
      contact: cfg.contactAtStart + (1 - cfg.contactAtStart) * t
    };
  }

  /* early-game-difficulty-1: is the player currently inside the Haven
   * Dock safe-zone bubble (rookie + Solace + within havenRange of the
   * starting station)? */
  function havenSafeActive(player) {
    var rf = rookieFactor('solace');
    if (!rf.active || !player) return false;
    if (!SF.Game || SF.Game.systemId !== 'solace') return false;
    var sys = SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID.solace;
    var st = sys && sys.station;
    if (!st) return false;
    var range = (SF.CONFIG.rookie && SF.CONFIG.rookie.havenRange) || 650;
    var dx = player.x - st.x, dy = player.y - st.y;
    return (dx * dx + dy * dy) <= range * range;
  }

  function spawn(typeId, x, y, mul, opts) {
    opts = opts || {};
    var spec = SF.CONFIG.enemies[typeId];
    // gameplay-depth: difficulty scaling by system danger (Solace < Drift < Ember)
    var diff = (SF.CONFIG.difficulty && SF.CONFIG.difficulty[SF.Game.systemId]) ||
      { dmgMul: 1, fireMul: 1 };
    // early-game-difficulty-1: rookie grace multiplies on top of the
    // system scaling (identity outside the window, so Drift/Ember and
    // veteran Solace are untouched). Raid/boss spawns bypass spawn() and
    // are gated separately (Bosses.tick gate; raids live in station.js).
    var rfSpawn = rookieFactor(SF.Game.systemId);
    var e = {
      type: typeId, spec: spec,
      x: x, y: y, vx: 0, vy: 0,
      angle: Math.random() * Math.PI * 2,
      hp: spec.hp * mul, maxHp: spec.hp * mul,
      radius: spec.radius,
      fireTimer: 1 + Math.random() * 2,
      // gameplay-depth: per-enemy fire interval + damage scaled by system danger
      fireInterval: (spec.fireInterval || 0) * diff.fireMul * rfSpawn.fireInt,
      dmgMul: diff.dmgMul * rfSpawn.dmg,
      rookieScaled: rfSpawn.active, // early-game-difficulty-1: runtime tag
      // enemy-ai-patterns: named behavior pattern (null = default AI).
      // Assigned via opts.pattern; validated against the SF.ENEMY_PATTERNS
      // registry. Runtime-only, save-neutral.
      pattern: (opts.pattern && SF.ENEMY_PATTERNS &&
        SF.ENEMY_PATTERNS[opts.pattern]) ? opts.pattern : null,
      pat: null, // enemy-ai-patterns: per-pattern runtime state
      state: 'chase',
      strafeDir: Math.random() < 0.5 ? 1 : -1,
      strafeTimer: 0,
      contactTimer: 0,
      flash: 0,
      weaveT: Math.random() * Math.PI * 2, // gameplay-depth: swarmer weave phase
      // Phase 4: faction patrols (null = pirates). playerAggro marks the
      // first shot the player fired at this patrol (standing hit once).
      faction: opts.faction || null,
      playerAggro: false,
      questOid: !!opts.questOid, // Phase 4: escort-ambush raiders
      storyOid: opts.storyOid || null, // story-campaign: scripted-encounter tag
      // gameplay-depth: encounter marks, traders, named bounty targets
      encounter: opts.encounter || null,
      trader: !!opts.trader,                 // neutral convoy freighter
      distressTrap: !!opts.distressTrap,     // distress beacon pirate trap
      bountyId: opts.bountyId || null,
      bountyName: opts.bountyName || null,
      // Phase 3: crew. Drones are automated (no crew, can't be boarded).
      crew: spec.crew || 0,
      crewStars: spec.crewStars
        ? spec.crewStars[0] + Math.floor(Math.random() * (spec.crewStars[1] - spec.crewStars[0] + 1))
        : 1,
      automated: !!spec.automated,
      adrift: false,
      raidSt: opts.raidSt || null, // station-defense: {sys,name,x,y} — besieges the station
    };
    // treaty-provocation: who-shot-first flag, default innocent.
    e.provoked = false;
    if (e.faction && window.SF && SF.Factions) {
      try {
        // spawned hostile: at-war stance ships enter as hostiles, never as
        // innocent patrols (interdiction ambushes spawn hostile the same way)
        if (SF.Factions.stance && SF.Factions.stance(e.faction) === 'hostile') e.provoked = true;
        // war-declared hostility lives in the treaties blob and doesn't move
        // raw standing, so check it too (guarded: treaties may merge later)
        if (!e.provoked && SF.Treaties && SF.Treaties.atWar && SF.Treaties.atWar(e.faction)) e.provoked = true;
      } catch (x) { /* factions/treaties unavailable in this harness */ }
    }
    if (e.faction && e.raidSt) e.provoked = true; // raiders besiege: hostile by definition
    // enemy-elites: apply variant stat modifiers (hull, speed, crew scale)
    if (opts.elite && SF.ELITE_VARIANTS && SF.ELITE_VARIANTS[opts.elite]) {
      var vd = SF.ELITE_VARIANTS[opts.elite];
      e.elite = opts.elite;
      e.eliteDef = vd;
      e.eliteName = SF.Elites ? SF.Elites.pickName(opts.elite) : vd.name;
      e.hp = e.hp * vd.hullMul; e.maxHp = e.maxHp * vd.hullMul;
      e.speedMul = vd.speedMul;
      // bigger hulls hold bigger crews (bulwark gunship: 8 -> 14 marines)
      if (!e.automated && e.crew > 0) e.crew = Math.max(1, Math.round(e.crew * vd.hullMul));
      if (window.SF && SF.Particles) SF.Particles.burst(x, y, vd.aura, 10, 220, 0.5, 3);
    }
    // enemy-ai-tactics-2: carrier launch state — gunship-class ships carry
    // a drone bay. e.carrier.drones holds LIVE drone refs (pruned every
    // tick in carrierPass); the timer seeds the first launch 2-5s out.
    // Runtime-only, save-neutral: never serialized.
    if (typeId === 'gunship') e.carrier = { drones: [], timer: 2 + Math.random() * 3 };
    list.push(e);
    return e;
  }

  /* station-defense: raid AI — besiege the station (chase in, orbit-strafe,
   * fire on the hull), flee when crippled. Real hostile bolts are spawned at
   * the station; SF.Raids.tick lands them on the station hull. Ramming the
   * ring damages the station (and the rammer). */
  function updateRaidEnemy(e, dt, player, worldSize) {
    emitEnrageAura(e, dt); // elite-enrage-phases: pulsing red aura while enraged
    var sx = e.raidSt.x, sy = e.raidSt.y;
    var dx = sx - e.x, dy = sy - e.y;
    var dist = Math.hypot(dx, dy) || 1;
    var nx = dx / dist, ny = dy / dist;
    if (e.hp < e.maxHp * SF.CONFIG.fleeHpFrac) e.state = 'flee';
    else if (e.type === 'drone') e.state = 'chase';
    else {
      e.strafeTimer -= dt;
      if (e.strafeTimer <= 0) {
        e.strafeTimer = 1.5 + Math.random() * 1.5;
        e.strafeDir *= -1;
      }
      e.state = dist > 380 ? 'chase' : 'strafe';
    }
    var sp = e.spec.speed * (e.speedMul || 1), ax = 0, ay = 0;
    if (e.state === 'flee') {
      ax = -nx * sp * 1.2; ay = -ny * sp * 1.2;
    } else if (e.state === 'chase') {
      ax = nx * sp; ay = ny * sp;
      if (e.type === 'drone') { // keep the swarmer weave on approach
        e.weaveT += dt * 4;
        var wob = Math.sin(e.weaveT) * 0.9 * sp;
        ax += -ny * wob; ay += nx * wob;
      }
    } else { // strafe: orbit the station at ~320
      var radial = dist > 360 ? 0.6 : (dist < 280 ? -0.6 : 0);
      ax = (-ny * e.strafeDir + nx * radial) * sp;
      ay = (nx * e.strafeDir + ny * radial) * sp;
    }
    var k = Math.min(1, 3 * dt);
    e.vx += (ax - e.vx) * k; e.vy += (ay - e.vy) * k;
    e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
    e.angle = Math.atan2(e.vy, e.vx);
    // fire on the station
    if (e.state !== 'flee' && e.spec.fireInterval && dist < 700) {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = (e.fireInterval || e.spec.fireInterval) * (0.85 + Math.random() * 0.3);
        var a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.14;
        SF.Projectiles.spawn(e.x, e.y, a, e.spec.boltSpeed,
          e.spec.boltDamage * (e.dmgMul || 1), false, '#ff9d5e',
          { radius: 4, life: 3.5 });
        SF.Audio.enemyLaser();
      }
    }
    // ramming the station ring
    if (dist < e.radius + 52 && e.contactTimer <= 0) {
      e.contactTimer = SF.CONFIG.player.contactCooldown;
      if (window.SF && SF.Raids) SF.Raids.damageStation(e.raidSt.sys, e.raidSt.name,
        e.spec.contact * 2, e.x, e.y);
      SF.Enemies.damage(e, 15);
    }
  }

  return {
    list: list,

    // treaty-provocation (2026-10-21): handoff consumed synchronously by the
    // SF.Treaties.onKill wrap around Factions.act('destroyPatrol') in kill().
    __provokedKillOf: null,
    // treaty-provocation: test hook — installs the SF.Treaties.onKill wrap.
    installTreatyProvocationWrap: installTreatyProvocationWrap,

    clear: function () { list.length = 0; },

    // early-game-difficulty-1: rookie-grace hooks (used by Bosses.tick,
    // Elites.roll, gameplay.js encounter/hunter gates, station.js raids
    // follow-up). rookieFactor(systemId) -> {active, level, t, dmg, fireInt}
    rookieFactor: rookieFactor,
    havenSafeActive: havenSafeActive,

    spawn: spawn,

    // sprite-wiring-enemies: test hook — loader key for an enemy
    spriteIdFor: function (e) { return enemySpriteId(e); },

    // enemy-ai-patterns: registry ids (spawn wiring hook)
    patternIds: function () { return Object.keys(SF.ENEMY_PATTERNS || {}); },

    // enemy-ai-tactics-2: test hooks — tactics tuning constants + per-enemy
    // coordination state (flankSlot, kiteVec, live escort count).
    tacticsConfig: function () { return SF.TACTICS; },
    tacticsDebug: function (e) {
      if (!e) return null;
      var live = 0;
      if (e.carrier && e.carrier.drones) {
        for (var d = 0; d < e.carrier.drones.length; d++)
          if (list.indexOf(e.carrier.drones[d]) >= 0) live++;
      }
      return {
        flankSlot: e.flankSlot || null,
        flankPing: e.flankPing || 0,
        kiteVec: e.kiteVec || null,
        carrierLive: live
      };
    },

    // v2-faction-ships-wiring: test hooks — faction sprite id + preload ids
    factionSpriteIdFor: function (e) { return factionSpriteId(e); },
    factionSpriteIds: FACTION_SPRITE_IDS,

    // elite-enrage-phases: test hooks — enrage tuning constants + state
    // reader (e.enraged latch, e.enrageAura aura tag are on the entity).
    enrageConfig: function () { return SF.ENRAGE; },
    isEnraged: function (e) { return !!(e && e.enraged); },
    // elite-enrage-phases: aura emitter shared with the SF.Bosses IIFE
    // below (a separate closure, so it cannot see emitEnrageAura directly).
    auraTick: emitEnrageAura,

    // Phase 4: some patrols fly faction colors instead of pirate colors.
    spawnPatrol: function (systemId, px, py) {
      var sys = SF.SYSTEM_BY_ID[systemId];
      var cfg = SF.CONFIG;
      var sysFaction = SYSTEM_FACTION[systemId] || null;
      // gameplay-depth: spawn budget scales with system danger
      var diff = (SF.CONFIG.difficulty && SF.CONFIG.difficulty[systemId]) || { budget: 1 };
      var n = Math.round((cfg.patrolSize[0] + Math.random() * (cfg.patrolSize[1] - cfg.patrolSize[0])) * diff.budget);
      n = Math.max(1, n);
      var factionSpawned = false;
      var eliteSpawned = false; // enemy-elites: any elite in this patrol
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var d = 650 + Math.random() * 300;
        var x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
        // open-space-1: patrol spawns near the player, wherever that is.
        x = x; y = y;
        var typeId = pickType(sys.enemyTable);
        var faction = null;
        if (sysFaction && !factionSpawned && Math.random() < 0.45 &&
            (typeId === 'raider' || typeId === 'gunship')) {
          faction = sysFaction;
          factionSpawned = true;
        }
        // enemy-elites: elite roll governed by system danger. Faction
        // patrols are never elites (standing consequences stay legible).
        // early-game-difficulty-1: hard gate — no elites in the rookie
        // window even if eliteRate is retuned later (Solace rate is 0
        // today; this keeps the promise structural, not config-deep).
        var elite = (faction === null && window.SF && SF.Elites &&
            !rookieFactor(systemId).active)
          ? SF.Elites.roll(systemId) : null;
        if (elite) eliteSpawned = true;
        // enemy-ai-patterns: faction ships sometimes fly named patterns.
        // Embers are the most aggressive, Solace the least. Kamikaze needs
        // a ramming hull (drone/raider); snipers want a ranged hull.
        var pattern = null;
        // early-game-difficulty-1: no named AI patterns (kamikaze/sniper/
        // weaver) in the rookie window — plain pirates only.
        if (faction && SF.ENEMY_PATTERNS && !rookieFactor(systemId).active) {
          var pChance = systemId === 'ember' ? 0.35 :
            (systemId === 'drift' ? 0.22 : 0.12);
          if (Math.random() < pChance) {
            var pks = ['kamikaze', 'weaver', 'sniper'];
            pattern = pks[Math.floor(Math.random() * pks.length)];
            if (pattern === 'kamikaze' && typeId === 'gunship') pattern = 'weaver';
            if (pattern === 'sniper' && typeId === 'drone') pattern = 'weaver';
          }
        }
        spawn(typeId, x, y, sys.enemyMul, { faction: faction, elite: elite, pattern: pattern });
      }
      if (factionSpawned && sysFaction && window.SF && SF.Factions) {
        var fdef = SF.FACTION_BY_ID[sysFaction];
        var stance = SF.Factions.stance(sysFaction);
        SF.HUD.toast(stance === 'friendly'
          ? fdef.name + ' patrol on scope — friendly'
          : fdef.name + ' patrol on scope');
      } else if (eliteSpawned) {
        // enemy-elites: an elite shipped in this patrol — call it out
        var ee = null;
        for (var ei = list.length - 1; ei >= 0; ei--) {
          if (list[ei].elite && list[ei].eliteName) { ee = list[ei]; break; }
        }
        SF.HUD.toast('\u26a0 ELITE SIGNATURE' + (ee ? ' \u2014 ' + ee.eliteName : ''));
      } else {
        SF.HUD.toast('Hostiles on scope!');
      }
    },

    damage: function (e, dmg, crit) {
      var oldFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      e.hp -= dmg;
      /* twelve-hour-wave2: hit flash reads instantly at phone size — 0.08s
       * was a single-frame blink at 60fps; normal hits now hold 0.12s and
       * crits 0.16s. Crits also render the orange larger number, an extra
       * spark stamp, and the crit cue (audio.js). */
      e.flash = crit ? 0.16 : 0.12;
      // b2-combat-feedback: dealt damage number, keyed per enemy so rapid
      // hits within 150 ms aggregate (fx.js). Display only; placed before
      // the kill check so the killing blow still shows. Central funnel:
      // player projectiles, splash, turrets, and ram all flow through here.
      try {
        if (e._b2key === undefined) e._b2key = 'e' + (++dmgSeq);
        if (window.SF && SF.FX && SF.FX.damageNumber)
          SF.FX.damageNumber(e.x, e.y, dmg, { type: crit ? 'crit' : 'dealt', crit: !!crit, key: e._b2key });
        if (crit) {
          if (window.SF && SF.Particles) SF.Particles.sparks(e.x, e.y, '#ff9500');
          if (window.SF && SF.Audio && SF.Audio.crit) SF.Audio.crit();
        }
      } catch (err) {}
      // early-game-difficulty-1: any damage taken marks the enemy as
      // provoked. damage() is overwhelmingly the player-weapons entry
      // point (main.js projectile hits, projectile splash); the internal
      // callers are the raid ram (raidSt enemies — excluded from the
      // Haven safe zone anyway), station turrets (a turret-engaged enemy
      // is already in a station firefight) and kamikaze self-detonation
      // (dies immediately). The Haven safe zone reads this flag as
      // "fired on first".
      if (!e.playerAggro) e.playerAggro = true;
      SF.Particles.burst(e.x, e.y, '#ffcf5e', 4, 160, 0.3, 3);
      // Phase 4: first player shot at a faction patrol costs standing + karma
      if (e.faction && !e.playerAggro && window.SF && SF.Factions) {
        e.playerAggro = true;
        SF.Factions.act('attackPatrol', e.faction);
        SF.HUD.toast('\u26a0 You fired on a ' + SF.FACTION_BY_ID[e.faction].name + ' patrol!');
      }
      // gameplay-depth: taking fire paints the player for nearby pirates (pack hunt)
      if (!e.faction && !e.trader) this.focusFire(e);
      // Phase 3: crew depletion as hull damage lands (marines die last)
      if (!e.automated && !e.adrift && e.crew > 0) {
        var newFrac = e.maxHp > 0 ? Math.max(0, e.hp) / e.maxHp : 1;
        var step = SF.CONFIG.crew.depleteHullStep;
        var steps = Math.floor(oldFrac / step) - Math.floor(newFrac / step);
        for (var s = 0; s < steps && e.crew > 0; s++) {
          var n = Math.max(1, Math.round(e.crew * SF.CONFIG.crew.depleteCrewFrac));
          e.crew = Math.max(0, e.crew - n);
        }
        if (e.crew === 0) {
          e.adrift = true;
          SF.HUD.toast('Hostile adrift — board it!');
        }
      }
      // boss-sfx-wiring: boss fight phases are SFX-only — advance the marker
      // (and fire the transition sfx) before the kill check so a killing
      // blow that crosses a threshold still plays the phase shift first.
      if (e.boss && window.SF && SF.Bosses && SF.Bosses.checkBossPhase)
        SF.Bosses.checkBossPhase(e);
      // elite-enrage-phases: enrage at <=30% hull, once per fight. A
      // one-shot kill (hp drops from above the threshold to <=0) does NOT
      // enrage — the guard on e.hp > 0 keeps the trigger honest.
      if (!e.enraged && e.hp > 0 && (e.elite || e.boss) && e.maxHp > 0 &&
          e.hp / e.maxHp <= SF.ENRAGE.HULL_FRAC) triggerEnrage(e);
      if (e.hp <= 0) this.kill(e);
    },

    // gameplay-depth: focus-fire — pirates near a ship the player just hit
    // converge on the player (pack hunt). Wingmen stay untargetable by design.
    focusFire: function (src) {
      var prof = (SF.CONFIG.aiProfiles && SF.CONFIG.aiProfiles[src.type]) || { focusRange: 600 };
      var R = prof.focusRange || 600;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e === src || e.faction || e.trader || e.adrift) continue;
        var d = Math.hypot(e.x - src.x, e.y - src.y);
        if (d < R) {
          e.state = 'chase';
          e.packHunt = 6; // seconds of focused aggression on the player
          e.fireTimer = Math.min(e.fireTimer, 0.4); // snap to attention
        }
      }
    },

    kill: function (e) {
      // boss-encounters: boss kills go through the boss module (custom rewards,
      // 10-min no-respawn timer) instead of the normal drop tables.
      if (e.boss) {
        var bidx = list.indexOf(e);
        if (bidx >= 0) list.splice(bidx, 1);
        if (window.SF && SF.Bosses) SF.Bosses.onKill(e);
        return;
      }
      var idx = list.indexOf(e);
      if (idx >= 0) list.splice(idx, 1);
      // enemy-ai-tactics-2: carrier launch — drone escorts despawn with the
      // carrier. kill() on the escorts pays out normal drone rewards (the
      // player earned them by cracking the bay).
      if (e.carrier && e.carrier.drones) {
        var esc = e.carrier.drones.slice();
        for (var di = 0; di < esc.length; di++) {
          if (list.indexOf(esc[di]) >= 0) this.kill(esc[di]);
        }
      }
      // enemy-ai-patterns: kamikaze detonation — area blast around the
      // wreck, whether it rammed home or was shot down mid-run. Only in
      // PLAYING so menu/test harnesses never take phantom damage.
      if (e.pattern === 'kamikaze' && SF.ENEMY_PATTERNS.kamikaze &&
          window.SF && SF.Player && SF.Player.takeDamage &&
          window.SF && SF.Game && SF.Game.state === 'PLAYING') {
        var KP = SF.ENEMY_PATTERNS.kamikaze;
        SF.Particles.explosion(e.x, e.y, 1.4);
        var pd = Math.hypot(SF.Player.x - e.x, SF.Player.y - e.y);
        if (pd < KP.blastRadius) {
          SF.Player.takeDamage(e.spec.contact * KP.blastDmgMul);
          SF.HUD.toast('\u26a0 Kamikaze detonation!');
        }
      }
      // enemy-elites: swarmlord death spawns 3 adds around the wreck
      if (e.elite === 'swarmlord' && SF.ELITE_VARIANTS && SF.ELITE_VARIANTS.swarmlord.adds) {
        var addType = e.type === 'gunship' ? 'raider' : 'drone';
        var addSys = SF.SYSTEM_BY_ID[SF.Game.systemId];
        var addMul = addSys ? addSys.enemyMul : 1;
        for (var ai = 0; ai < SF.ELITE_VARIANTS.swarmlord.adds; ai++) {
          var aa = Math.random() * Math.PI * 2;
          var axx = e.x + Math.cos(aa) * 90;
          var ayy = e.y + Math.sin(aa) * 90;
          SF.Enemies.spawn(addType, axx, ayy, addMul);
        }
        SF.HUD.toast('\u26a0 The brood scatters \u2014 3 adds inbound!');
      }
      // Phase 4: faction/karma consequences + quest progress
      if (window.SF && SF.Factions) {
        if (e.faction) {
          // treaty-provocation: hand the who-shot-first verdict to the treaty
          // decay chain. The SF.Treaties.onKill wrap (installed lazily here so
          // merge order vs the treaties phase doesn't matter) skips pact decay
          // for provoked kills. The handoff is consumed synchronously inside
          // act() — multi-kills in one frame stay exact. Standing/karma
          // consequences in act() are untouched. No direct Treaties.onKill
          // call: the Factions.onKill wrap already calls it exactly once, and
          // a second call would double-count decay.
          installTreatyProvocationWrap();
          SF.Enemies.__provokedKillOf = e.provoked ? e.faction : null;
          try { SF.Factions.act('destroyPatrol', e.faction); }
          finally { SF.Enemies.__provokedKillOf = null; }
        }
        else SF.Factions.act('killPirate');
      }
      // station-defense: raid kill tracking (standing + kill count)
      if (e.raidSt && window.SF && SF.Raids) SF.Raids.onRaiderKilled(e);
      if (window.SF && SF.Quests) SF.Quests.onKill(e);
      if (window.SF && SF.Bounty) SF.Bounty.onKill(e); // gameplay-depth: bounty targets
      // enemy-elites: elite kill banner + local-faction standing reward.
      // Fires LAST so the elite banner is the final toast the player sees.
      if (e.elite && e.eliteName) {
        var sysF = SYSTEM_FACTION[SF.Game.systemId];
        var eGain = (SF.CONFIG.eliteStanding !== undefined) ? SF.CONFIG.eliteStanding : 4;
        if (window.SF && SF.Factions && sysF && SF.FACTION_BY_ID[sysF]) {
          SF.Factions.shift(sysF, eGain);
          SF.HUD.toast('\u2620 ELITE KILLED \u2014 ' + e.eliteName + ' \u00b7 ' +
            SF.FACTION_BY_ID[sysF].name + ' +' + eGain + ' standing');
        } else {
          SF.HUD.toast('\u2620 ELITE KILLED \u2014 ' + e.eliteName);
        }
        if (window.SF && SF.News) SF.News.push('\u2620 Elite pilot ' + e.eliteName +
          ' destroyed in ' + SF.SYSTEM_BY_ID[SF.Game.systemId].name + '.');
      }
      var spec = e.spec;
      var big = e.type === 'gunship';
      // graphics-juice: layered explosion + shake on kill
      SF.Particles.explosion(e.x, e.y, big ? 1.7 : 1.0);
      if (window.SF && SF.FX) SF.FX.shake(big ? 9 : 5);
      SF.Audio.explosion(big);
      /* twelve-hour-wave2: kill confirmation cue — the explosion carries
       * the boom, this short rise says "that one is yours" (KillFeed +
       * CombatFeed already confirm visually; boss kills keep their own
       * finisher/explosion path above via the early return). */
      if (window.SF && SF.Audio && SF.Audio.killConfirm) SF.Audio.killConfirm();
      var credits = spec.creditsMin + Math.floor(Math.random() * (spec.creditsMax - spec.creditsMin + 1));
      // enemy-elites: elite credit bonus
      if (e.eliteDef && e.eliteDef.creditMul) credits = Math.round(credits * e.eliteDef.creditMul);
      SF.Pickups.spawnCredits(e.x, e.y, credits);
      var ore = spec.oreMin + Math.floor(Math.random() * (spec.oreMax - spec.oreMin + 1));
      for (var i = 0; i < ore; i++) SF.Pickups.spawnOre(e.x, e.y, 1);
      if (Math.random() < spec.itemChance) {
        var weights = SF.ITEM_DROPS[e.type];
        var total = weights[0] + weights[1] + weights[2];
        var r = Math.random() * total, id = SF.ITEMS[0].id;
        if (r < weights[0]) id = SF.ITEMS[0].id;
        else if (r < weights[0] + weights[1]) id = SF.ITEMS[1].id;
        else id = SF.ITEMS[2].id;
        SF.Pickups.spawnItem(e.x, e.y, id);
      }
      // Phase 2: salvaged ship parts from tougher kills
      var partChance = (SF.CONFIG.partDrops && SF.CONFIG.partDrops[e.type]) || 0;
      if (Math.random() < partChance) {
        var commons = [];
        for (var pi = 0; pi < SF.PARTS.length; pi++) {
          if (SF.PARTS[pi].tier === 'white' || SF.PARTS[pi].tier === 'green') commons.push(SF.PARTS[pi]);
        }
        if (commons.length) {
          var rp = commons[Math.floor(Math.random() * commons.length)];
          SF.Pickups.spawnPart(e.x, e.y, rp.id);
        }
      }
      // weapons-arsenal: tier-appropriate weapon + mod drops (never craft-only)
      var wChance = (SF.CONFIG.weaponDrops && SF.CONFIG.weaponDrops[e.type]) || 0;
      if (Math.random() < wChance && SF.WEAPON_DROPS && SF.WEAPON_DROPS[e.type]) {
        var wids = SF.WEAPON_DROPS[e.type];
        var wid = wids[Math.floor(Math.random() * wids.length)];
        if (wid && SF.WEAPON_BY_ID[wid] && !SF.WEAPON_BY_ID[wid].craftOnly) {
          SF.Pickups.spawnWeapon(e.x, e.y, wid);
        }
      }
      var mChance = (SF.CONFIG.modDrops && SF.CONFIG.modDrops[e.type]) || 0;
      if (Math.random() < mChance && SF.MOD_DROPS && SF.MOD_DROPS[e.type]) {
        var mids = SF.MOD_DROPS[e.type];
        SF.Pickups.spawnMod(e.x, e.y, mids[Math.floor(Math.random() * mids.length)]);
      }
      // enemy-elites: elite loot tables (rare parts/mods via the weapons-arsenal
      // drop logic, guaranteed elite-weighted component)
      if (e.elite) {
        var ed = SF.CONFIG.eliteDrops || {};
        // guaranteed component, elite-weighted toward blue/purple
        var ew = SF.ELITE_ITEM_WEIGHTS || [10, 50, 40];
        var ewTotal = ew[0] + ew[1] + ew[2];
        var er = Math.random() * ewTotal, eIdx = 0;
        if (er < ew[0]) eIdx = 0;
        else if (er < ew[0] + ew[1]) eIdx = 1;
        else eIdx = 2;
        if (SF.ITEMS[eIdx]) SF.Pickups.spawnItem(e.x, e.y, SF.ITEMS[eIdx].id);
        // elite weapon roll from the base type's weapon table (never craft-only)
        if (Math.random() < (ed.weaponChance || 0.5) &&
            SF.WEAPON_DROPS && SF.WEAPON_DROPS[e.type]) {
          var ewids = SF.WEAPON_DROPS[e.type];
          var ewid = ewids[Math.floor(Math.random() * ewids.length)];
          if (ewid && SF.WEAPON_BY_ID[ewid] && !SF.WEAPON_BY_ID[ewid].craftOnly) {
            SF.Pickups.spawnWeapon(e.x, e.y, ewid);
          }
        }
        // elite mod roll from the base type's mod table
        if (Math.random() < (ed.modChance || 0.35) &&
            SF.MOD_DROPS && SF.MOD_DROPS[e.type]) {
          var emids = SF.MOD_DROPS[e.type];
          SF.Pickups.spawnMod(e.x, e.y, emids[Math.floor(Math.random() * emids.length)]);
        }
        // elite part roll: green/blue/purple ship parts (normals get white/green)
        if (Math.random() < (ed.partChance || 0.5) && SF.PARTS && SF.PARTS.length) {
          var erares = [];
          for (var rpi = 0; rpi < SF.PARTS.length; rpi++) {
            var rt = SF.PARTS[rpi].tier;
            if (rt === 'green' || rt === 'blue' || rt === 'purple') erares.push(SF.PARTS[rpi]);
          }
          if (erares.length) {
            var erp = erares[Math.floor(Math.random() * erares.length)];
            SF.Pickups.spawnPart(e.x, e.y, erp.id);
          }
        }
      }
    },

    update: function (dt, player, worldSize) {
      // enemy-ai-tactics-2: coordination passes (additive; run before the
      // per-enemy AI loop so steering reads this tick's assignments)
      tacticsPackPass(dt, player);      // pack flanking: sector assignment
      carrierPass(dt, player, worldSize); // carrier launch: drone escorts
      // early-game-difficulty-1: per-tick rookie state (identity outside
      // the window) — contact scaling + Haven safe zone, computed once.
      var rfUpdate = rookieFactor(SF.Game ? SF.Game.systemId : null);
      var havenSafe = havenSafeActive(player);
      for (var i = list.length - 1; i >= 0; i--) {
        var e = list[i];
        // freeze-hunt-1 (suspect b): a raid ram can end the raid mid-loop —
        // station.js fail() splices every raider out of this list, shrinking
        // it below the loop's captured start index; list[i] then reads
        // undefined and e.flash threw a one-frame TypeError. Skip the hole;
        // shifted survivors are picked up next tick.
        if (!e) continue;
        // open-space-1: far-cull, placed at loop top so it applies to
        // every branch (EMP/adrift/trader/haven/friendly all `continue`
        // below). The world is unbounded, so ambient ships left far
        // behind despawn instead of accumulating forever. Bosses never
        // cull (story); raid wings besieging their station (within
        // 1500u of raidSt) never cull; everything else goes past 5000u
        // from the player. Reverse loop, so the splice is safe.
        if (!e.boss) {
          var cd0 = Math.hypot(e.x - player.x, e.y - player.y);
          var besieging0 = false;
          if (e.raidSt) {
            var rdx0 = e.x - e.raidSt.x, rdy0 = e.y - e.raidSt.y;
            besieging0 = (rdx0 * rdx0 + rdy0 * rdy0) < 1500 * 1500;
          }
          if (cd0 > 5000 && !besieging0) { list.splice(i, 1); continue; }
        }
        // beta2-pressure-tutorial: break-off leash. A pirate the player
        // has outrun — still over 900 away for 4 straight seconds —
        // gives up the chase and flies off instead of trailing forever
        // to the 5000 far-cull. 900 sits just past max weapon reach, so
        // a fighter in gun range never triggers it; an escaper clears
        // their trailers within one flight leg (a Fighter at 250px/s
        // opens 100px/s on a 150px/s drone: 900 in ~9s from contact).
        // The first tuning (1600/10s) never fired inside a 15s flight
        // leg — the probe proved it, so the threshold moved here.
        // Excluded: bosses, raids, faction ships (standing must stay
        // legible), traders, adrift hulls, bounty/quest/story targets,
        // elites. Runtime-only flags (leashT/brokeOff); nothing
        // serialized, no save change.
        if (!e.boss && !e.raidSt && !e.faction && !e.trader && !e.adrift &&
            !e.bountyId && !e.questOid && !e.storyOid && !e.elite) {
          var cdL = Math.hypot(e.x - player.x, e.y - player.y);
          if (cdL > 900) {
            e.leashT = (e.leashT || 0) + dt;
            if (e.leashT >= 4) e.brokeOff = true;
          } else e.leashT = 0;
          if (e.brokeOff) {
            var bx = e.x - player.x, by = e.y - player.y;
            var bl = Math.hypot(bx, by) || 1;
            var bsp = (e.spec.speed || 150) * (e.speedMul || 1);
            e.vx = bx / bl * bsp; e.vy = by / bl * bsp;
            e.x += e.vx * dt; e.y += e.vy * dt;
            if (Math.hypot(e.x - player.x, e.y - player.y) > 1800) { list.splice(i, 1); }
            continue;
          }
        }
        if (e.flash > 0) e.flash -= dt;
        if (e.contactTimer > 0) e.contactTimer -= dt;
        // elite-enrage-phases: pulsing red particle aura while enraged
        emitEnrageAura(e, dt);

        // boss-encounters: capital-ship bosses run their own update
        // (EMP-immune, never adrift, never flee) but stay in the shared list
        // so collision / projectile plumbing just works.
        if (e.boss && window.SF && SF.Bosses) {
          SF.Bosses.updateBoss(dt, e, player, worldSize);
          continue;
        }

        // weapons-arsenal: EMP stun — no AI, no weapons, no contact damage
        if (e.empTimer > 0) {
          e.empTimer -= dt;
          var dampS = Math.max(0, 1 - 3 * dt);
          e.vx *= dampS; e.vy *= dampS;
          e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
          continue;
        }

        // Phase 3: adrift ships are dead in the water — no AI, no weapons
        if (e.adrift) {
          emitEnrageAura(e, dt); // enrage aura still pulses on an adrift hull
          var damp = Math.max(0, 1 - 0.6 * dt);
          e.vx *= damp; e.vy *= damp;
          e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
          continue;
        }

        // gameplay-depth: neutral traders fly straight and hold fire unless provoked
        if (e.trader && !e.playerAggro) {
          e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
          e.angle = Math.atan2(e.vy, e.vx);
          continue;
        }

        // station-defense: raid enemies besiege the station, not the player
        if (e.raidSt) {
          updateRaidEnemy(e, dt, player, worldSize);
          continue;
        }

        // early-game-difficulty-1: Haven Dock safe zone — while a rookie
        // sits inside the Haven bubble, UNPROVOKED hostiles hold position
        // with weapons cold: no chase, no fire, no contact damage. Firing
        // on one first (damage() sets playerAggro) opts out per-enemy.
        // Bosses are exempt here but cannot spawn in rookie Solace at
        // all (Bosses.tick gate below).
        if (havenSafe && !e.playerAggro && !e.boss) {
          var dampH = Math.max(0, 1 - 2 * dt);
          e.vx *= dampH; e.vy *= dampH;
          e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
          continue;
        }

        var dx = player.x - e.x, dy = player.y - e.y;
        var dist = Math.hypot(dx, dy) || 1;
        var nx = dx / dist, ny = dy / dist;
        var prof = (SF.CONFIG.aiProfiles && SF.CONFIG.aiProfiles[e.type]) || null;

        // Phase 4: faction patrol behavior follows standing
        var fStance = null;
        if (e.faction && window.SF && SF.Factions) fStance = SF.Factions.stance(e.faction);
        if (fStance === 'friendly') {
          // stand down: drift to a stop, weapons cold, no contact damage
          var dampF = Math.max(0, 1 - 2 * dt);
          e.vx *= dampF; e.vy *= dampF;
          e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
          continue;
        }

        // enemy-ai-patterns: named patterns replace the chase/strafe AI.
        // Flee still takes precedence; neutral patrols fly patterns only
        // once provoked (see patternWilling).
        if (e.pattern && SF.ENEMY_PATTERNS[e.pattern] && patternWilling(e)) {
          if (e.hp < e.maxHp * SF.CONFIG.fleeHpFrac) e.state = 'flee';
          else {
            updatePatternEnemy(e, dt, player, worldSize);
            continue;
          }
        }

        // state selection
        if (e.hp < e.maxHp * SF.CONFIG.fleeHpFrac) e.state = 'flee';
        else if (e.type === 'drone') e.state = 'chase';
        else if (e.type === 'raider') {
          e.strafeTimer -= dt;
          if (e.strafeTimer <= 0) {
            e.strafeTimer = 1.5 + Math.random() * 1.5;
            // gameplay-depth: coordinated flanking — flankers balance the
            // squad left/right instead of all orbiting one way
            if (prof && prof.flank) {
              var left = 0, right = 0;
              for (var q = 0; q < list.length; q++) {
                var al2 = list[q];
                if (al2 === e || al2.type !== 'raider' || al2.adrift) continue;
                if (Math.hypot(al2.x - e.x, al2.y - e.y) < 600) {
                  if (al2.strafeDir === 1) right++; else left++;
                }
              }
              e.strafeDir = left <= right ? -1 : 1;
            } else {
              e.strafeDir *= -1;
            }
          }
          e.state = dist > 340 ? 'chase' : 'strafe';
        } else e.state = dist > 420 ? 'chase' : 'strafe';
        // Phase 4: hostile patrols hunt the player relentlessly
        if (fStance === 'hostile' && e.state !== 'flee') e.state = 'chase';
        // gameplay-depth: pack hunt overrides strafe while the timer runs
        if (e.packHunt > 0 && e.state !== 'flee') {
          e.packHunt -= dt;
          e.state = 'chase';
        }

        var ax = 0, ay = 0, sp = e.spec.speed * (e.speedMul || 1); // enemy-elites: variant speed
        if (e.state === 'flee') {
          // gameplay-depth: tactical retreat — flee fast with a zigzag weave
          var fsp = sp * (prof ? prof.fleeSpd : 1) * 1.2;
          e.fleeWeave = (e.fleeWeave || 0) + dt;
          var wz = Math.sin(e.fleeWeave * 7) * 0.8;
          ax = -nx * fsp + (-ny) * wz * fsp * 0.6;
          ay = -ny * fsp + nx * wz * fsp * 0.6;
        } else if (e.state === 'chase') {
          ax = nx * sp; ay = ny * sp;
          // gameplay-depth: swarmer weave — drones corkscrew as they close
          if (prof && prof.weave && e.type === 'drone') {
            e.weaveT += dt * 4;
            var wob = Math.sin(e.weaveT) * prof.weave * sp;
            ax += -ny * wob; ay += nx * wob;
          }
        } else { // strafe: orbit + slight approach/retreat
          var want = (prof && prof.strafeWant) || (e.type === 'raider' ? 300 : 380);
          var radial = dist > want + 40 ? 0.6 : (dist < want - 40 ? -0.6 : 0);
          ax = (-ny * e.strafeDir + nx * radial) * sp;
          ay = (nx * e.strafeDir + ny * radial) * sp;
        }
        // enemy-ai-tactics-2: pack-flanking sector steering — blend the
        // default chase/strafe vector toward this raider's arc-sector slot
        // so the pack spreads around the player instead of clustering.
        // Additive blend only; flee/pattern/raid AI never see it.
        if (e.flankSlot && e.state !== 'flee') {
          var FW = SF.TACTICS.flank.steerW, FR = SF.TACTICS.flank.orbitR;
          var fsx = player.x + Math.cos(e.flankSlot.ang) * FR;
          var fsy = player.y + Math.sin(e.flankSlot.ang) * FR;
          var fvx = (fsx - e.x) * 1.5, fvy = (fsy - e.y) * 1.5;
          var fmax = sp * 1.25, fl = Math.hypot(fvx, fvy);
          if (fl > fmax) { fvx = fvx / fl * fmax; fvy = fvy / fl * fmax; }
          ax = ax * (1 - FW) + fvx * FW;
          ay = ay * (1 - FW) + fvy * FW;
        }
        // steer velocity toward desired
        var k = Math.min(1, 3 * dt);
        e.vx += (ax - e.vx) * k; e.vy += (ay - e.vy) * k;
        e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
        e.angle = Math.atan2(e.vy, e.vx);

        // shooting — Phase 4: neutral faction patrols only engage if the
        // player fired first or the player gets dangerously close.
        // gameplay-depth: traders hold fire unless provoked.
        var willFire = e.state !== 'flee' && e.spec.fireInterval && dist < 700;
        if (e.faction && fStance === 'neutral' && !e.playerAggro && dist > 260) willFire = false;
        if (e.trader && !e.playerAggro) willFire = false;
        if (willFire) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            // treaty-provocation: fired before the player ever damaged it
            if (e.faction && !e.playerAggro) e.provoked = true;
            // gameplay-depth: per-enemy interval already scaled by system danger
            e.fireTimer = (e.fireInterval || e.spec.fireInterval) * (0.85 + Math.random() * 0.3);
            var a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.12;
            var homing = !!e.spec.homing;
            // gameplay-depth: bolt damage scaled by system danger
            var boltDmg = e.spec.boltDamage * (e.dmgMul || 1);
            SF.Projectiles.spawn(e.x, e.y, a, e.spec.boltSpeed, boltDmg,
              false, homing ? '#ff5e3a' : '#ff9d5e',
              { radius: 4, homing: homing, turn: 1.6, life: 3.5,
                target: homing ? player : null });
            SF.Audio.enemyLaser();
          }
        }

        // contact damage — Phase 4: friendly patrols never collide-attack
        // (they stand down entirely above; this is belt-and-braces)
        if (dist < e.radius + player.radius && e.contactTimer <= 0 && fStance !== 'friendly') {
          e.contactTimer = SF.CONFIG.player.contactCooldown;
          // early-game-difficulty-1: ramming hurts a rookie less too —
          // the probe showed contact is ~75% of a stationary rookie's
          // incoming DPS, so it gets its own (stronger) multiplier.
          // rfUpdate.contact is 1 outside the window — no-op there.
          player.takeDamage(Math.max(1, Math.round(e.spec.contact * rfUpdate.contact)));
        }
      }

      // boss-encounters: boss spawn scheduler (runtime-only, save-neutral)
      if (window.SF && SF.Bosses) SF.Bosses.tick(dt, player, worldSize);

      // station-defense: raid scheduler + turret fire + hostile-bolt-vs-station
      if (window.SF && SF.Raids) SF.Raids.tick(dt, player, worldSize);

      // cheap separation so enemies don't stack
      for (var a = 0; a < list.length; a++) {
        for (var b = a + 1; b < list.length; b++) {
          var A = list[a], B = list[b];
          var ddx = B.x - A.x, ddy = B.y - A.y;
          var dd = Math.hypot(ddx, ddy);
          var min = A.radius + B.radius;
          if (dd > 0.01 && dd < min) {
            var push = (min - dd) / 2;
            var ux = ddx / dd, uy = ddy / dd;
            A.x -= ux * push; A.y -= uy * push;
            B.x += ux * push; B.y += uy * push;
          }
        }
      }
    },

    draw: function (ctx) {
      preloadEnemySprites(); // lazy kick so sprites are ready on first sight
      /* b-perf: view-cull the hull block only. The hull sprite (and its
       * glow + flash stamps) is canvas-clipped when offscreen, so
       * skipping it changes no visible pixel; the faction ring, elite
       * aura, telegraphs, kite vector, flank ping and hull bar below
       * still draw for offscreen enemies — the sniper lock line (up to
       * 2100px) and kamikaze aim line are gameplay warnings and are
       * deliberately NOT culled with the hull. Bosses go through
       * drawBoss, which applies the same split (hull culled, name tag +
       * telegraphs kept). On s25 the additive engine-glow stamp is
       * skipped as well (hull + flash remain). */
      var view = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var vis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      var s25 = !!(window.SF && SF.FX && SF.FX.getEffective &&
                   SF.FX.getEffective() === 's25');
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        // boss-encounters: capital ships get their own renderer + telegraphs
        if (e.boss) {
          if (window.SF && SF.Bosses) SF.Bosses.drawBoss(ctx, e);
          continue;
        }
        var hullOnScreen = !vis || vis(view, e.x, e.y, e.radius * SPRITE_SCALE / 2 + 8);
        if (!hullOnScreen) {
          // fall through to the ring/tag/telegraph/hull-bar sections below
          // without the save/translate/sprite block; the sections read
          // only e.* fields, so skipping the block is state-safe.
        } else {
        ctx.save();
        ctx.translate(e.x, e.y);
        var flash = e.flash > 0;
        // v2-faction-ships-wiring: faction-class sprite first (nose-up art
        // rotated into the nose-+X frame — the player-hull convention),
        // then the older 'enemies'-kind sprite, then the procedural hull.
        // b4-sprite-lighting: flash no longer forces the procedural hull —
        // the sprite is resolved regardless and a white silhouette of it
        // is stamped over it below while flashing. Loader-null keeps
        // falling back, so the game never breaks on a missing sprite.
        var spr = null, sprKind = null;
        if (window.SF && SF.Sprites) {
          var fsid = factionSpriteId(e);
          if (fsid) { spr = SF.Sprites.get('factions', fsid); if (spr) sprKind = 'factions'; }
          if (!spr) { spr = SF.Sprites.get('enemies', enemySpriteId(e)); if (spr) sprKind = 'enemies'; }
        }
        var ss = e.radius * SPRITE_SCALE;
        if (spr) {
          ctx.rotate(e.angle + Math.PI / 2); // nose-up art -> nose-+X frame
          /* twelve-hour-wave4 readability: dark halo disc under the
           * sprite (fill only, no extra drawImage) so enemies read
           * against bright backgrounds at phone size. */
          ctx.fillStyle = 'rgba(4,8,18,0.50)';
          ctx.beginPath(); ctx.arc(0, 0, ss * 0.52, 0, Math.PI * 2); ctx.fill();
          /* hud-sprite-improve: the enemies-kind engine-glow variants
           * (22 files) shipped but were never requested. Draw them
           * additively under the hull, mirroring the player ship's
           * glow pass (ship.js). Ids without a glow file get null and
           * simply skip — faction hulls have no glow art. */
          if (sprKind === 'enemies' && !s25) {
            var eglow = SF.Sprites.get('enemies', enemySpriteId(e) + '_glow');
            if (eglow) {
              ctx.save();
              ctx.globalAlpha = 0.45 + 0.25 * Math.sin(performance.now() / 140 + e.x * 0.01);
              ctx.globalCompositeOperation = 'lighter';
              ctx.drawImage(eglow, -ss / 2, -ss / 2, ss, ss);
              ctx.restore();
            }
          }
          ctx.drawImage(spr, -ss / 2, -ss / 2, ss, ss);
          // b4-sprite-lighting: sprite-preserving flash — white silhouette
          // of the exact sprite at the same geometry, instead of the old
          // procedural white hull.
          if (flash) {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.drawImage(whiteSilhouette(spr), -ss / 2, -ss / 2, ss, ss);
            ctx.restore();
          }
        } else {
          ctx.rotate(e.angle); // procedural hulls are authored nose-+X
          if (e.type === 'drone') {
            ctx.fillStyle = flash ? '#fff' : '#c24545';
            ctx.beginPath();
            ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9);
            ctx.closePath(); ctx.fill();
          } else if (e.type === 'raider') {
            ctx.fillStyle = flash ? '#fff' : '#c2703a';
            ctx.beginPath();
            ctx.moveTo(15, 0); ctx.lineTo(-10, -11); ctx.lineTo(-5, 0); ctx.lineTo(-10, 11);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = flash ? '#fff' : '#8a4a22';
            ctx.fillRect(-2, -3, 8, 6);
          } else { // gunship
            ctx.fillStyle = flash ? '#fff' : '#7a3ac2';
            ctx.beginPath();
            ctx.moveTo(20, 0); ctx.lineTo(-14, -14); ctx.lineTo(-8, 0); ctx.lineTo(-14, 14);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = flash ? '#fff' : '#4e247e';
            ctx.fillRect(-6, -5, 14, 10);
          }
        }
        ctx.restore();
        } // b-perf: end hull block (skipped whole when hull offscreen)
        // Phase 4: faction patrols fly a faction-color ring
        if (e.faction && window.SF && SF.FACTION_BY_ID[e.faction]) {
          ctx.save();
          ctx.strokeStyle = SF.FACTION_BY_ID[e.faction].color;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 6, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        // enemy-elites: colored pulsing aura ring + name tag. Plain canvas
        // primitives — particles.js deliberately untouched (out of scope).
        if (e.elite && e.eliteDef) {
          var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
          ctx.save();
          ctx.strokeStyle = e.eliteDef.aura;
          ctx.globalAlpha = 0.55 + 0.35 * pulse;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([8, 5]);
          ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 10 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = 6;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 4, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          // always-on elite name tag so pilots can spot elites at range
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = e.eliteDef.aura;
          ctx.fillText('\u2605 ELITE: ' + e.eliteName.toUpperCase(), e.x, e.y - e.radius - 18);
        }
        // elite-enrage-phases: red pulsing enrage ring (plain canvas,
        // layered over the variant aura). Drawn when the aura tag is set.
        if (e.enrageAura) {
          var epulse = 0.5 + 0.5 * Math.sin(Date.now() / 140);
          ctx.save();
          ctx.strokeStyle = '#ff2a2a';
          ctx.globalAlpha = 0.6 + 0.35 * epulse;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius + 16 + epulse * 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // enemy-ai-patterns: telegraphs — kamikaze warning triangle + aim
        // line during the 0.6s telegraph, sniper beam lock line that
        // thickens as the 1.2s charge completes. Plain canvas, zero deps.
        if (e.pattern && e.pat && window.SF && SF.ENEMY_PATTERNS) {
          if (e.pattern === 'kamikaze' && e.pat.phase === 'telegraph') {
            var kfrac = 1 - e.pat.t / SF.ENEMY_PATTERNS.kamikaze.telegraph;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,80,60,' +
              (0.5 + 0.5 * Math.sin(Date.now() / 90)).toFixed(2) + ')';
            ctx.lineWidth = 2 + 2 * kfrac;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y - e.radius - 14);
            ctx.lineTo(e.x - 10, e.y - e.radius - 32);
            ctx.lineTo(e.x + 10, e.y - e.radius - 32);
            ctx.closePath(); ctx.stroke();
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x + Math.cos(e.pat.ang) * 300,
              e.y + Math.sin(e.pat.ang) * 300);
            ctx.stroke();
            ctx.restore();
          } else if (e.pattern === 'sniper' && e.pat.phase === 'lock') {
            var sfrac = 1 - e.pat.t / SF.ENEMY_PATTERNS.sniper.telegraph;
            // enemy-ai-tactics-2: the lock line spans the long-range standoff
            // (tactics lockRange + margin) instead of the old 900px.
            var lockLen = (window.SF && SF.TACTICS) ?
              SF.TACTICS.sniper.lockRange + 200 : 900;
            ctx.save();
            ctx.strokeStyle = 'rgba(184,244,255,' +
              (0.3 + 0.7 * sfrac).toFixed(2) + ')';
            ctx.lineWidth = 1 + 3 * sfrac;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x + Math.cos(e.pat.ang) * lockLen,
              e.y + Math.sin(e.pat.ang) * lockLen);
            ctx.stroke();
            ctx.restore();
          }
        }
        // enemy-ai-tactics-2: sniper retreat vector — dashed cyan arrow in
        // the kiting direction while the sniper repositions to its standoff.
        if (e.kiteVec) {
          ctx.save();
          ctx.strokeStyle = 'rgba(184,244,255,0.75)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          var kx = e.x + e.kiteVec.x * 110, ky = e.y + e.kiteVec.y * 110;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y); ctx.lineTo(kx, ky);
          ctx.stroke();
          ctx.setLineDash([]);
          var ha = Math.atan2(e.kiteVec.y, e.kiteVec.x);
          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.lineTo(kx - Math.cos(ha - 0.4) * 12, ky - Math.sin(ha - 0.4) * 12);
          ctx.moveTo(kx, ky);
          ctx.lineTo(kx - Math.cos(ha + 0.4) * 12, ky - Math.sin(ha + 0.4) * 12);
          ctx.stroke();
          ctx.restore();
        }
        // enemy-ai-tactics-2: formation-change ping — expanding ring that
        // fades as e.flankPing counts down (set in tacticsPackPass).
        if (e.flankPing > 0 && window.SF && SF.TACTICS) {
          var pfrac = 1 - e.flankPing / SF.TACTICS.flank.pingT;
          ctx.save();
          ctx.strokeStyle = 'rgba(127,212,255,' +
            (0.7 * (1 - pfrac)).toFixed(2) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius + pfrac * 46, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Phase 3: floating combat readout — hull bar + crew number underneath.
        // Drones show AUTOMATED instead of a crew count.
        var pdx = e.x - SF.Player.x, pdy = e.y - SF.Player.y;
        var engaged = (e.hp < e.maxHp) || (pdx * pdx + pdy * pdy < 700 * 700);
        if (engaged) {
          var w = e.radius * 2, f = Math.max(0, e.hp / e.maxHp);
          var by = e.y - e.radius - 12;
          /* hud-dup-fix: nameplate tags take SEQUENTIAL 12px slots
           * upward from by-6 instead of the old shared offsets — faction
           * PATROL, ⚠ RAID and ESCORT all painted at by-6, and WANTED /
           * pattern / ENRAGED collided at by-18 whenever two applied, so
           * multi-tag ships rendered their tags on top of each other
           * (user recording 2026-10-23). Single-tag ships are unchanged:
           * their one tag still lands at by-6. Elites reserve the by-6
           * line for the always-on ★ ELITE name tag (drawn above at
           * e.y - e.radius - 18 === by - 6), so their stack starts one
           * line higher. */
          var tagY = by - 6 - ((e.elite && e.eliteName && e.eliteDef) ? 12 : 0);
          function tag(txt, color) {
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = color;
            ctx.fillText(txt, e.x, tagY);
            tagY -= 12;
          }
          // Phase 4: faction patrol tag
          if (e.faction && window.SF && SF.FACTION_BY_ID[e.faction]) {
            tag(SF.FACTION_BY_ID[e.faction].name.toUpperCase() + ' PATROL',
                SF.FACTION_BY_ID[e.faction].color);
          }
          // station-defense: raid marker so defenders can spot station attackers
          if (e.raidSt) tag('⚠ RAID', '#ff5e3a');
          // gameplay-depth: named bounty target tag
          if (e.bountyName) tag('☠ WANTED: ' + e.bountyName.toUpperCase(), '#ffd23f');
          // enemy-ai-patterns: pattern tag so pilots learn the tells
          if (e.pattern && e.pat && e.pat.phase !== 'start') {
            tag(e.pattern.toUpperCase(), e.pattern === 'kamikaze' ? '#ff5e3a' :
              (e.pattern === 'sniper' ? '#b8f4ff' : '#ffd23f'));
          }
          // enemy-ai-tactics-2: carrier escort tag
          if (e.carrierOf) tag('ESCORT', '#b45cff');
          // elite-enrage-phases: ENRAGED tag above the hull bar
          if (e.enrageAura) tag('\u{1F525} ENRAGED', '#ff2a2a');
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(e.x - w / 2, by, w, 5);
          ctx.fillStyle = f > 0.5 ? '#3ddc5f' : (f > 0.25 ? '#ffcf5e' : '#ff5e3a');
          ctx.fillRect(e.x - w / 2, by, w * f, 5);
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = e.automated ? '#8a93a8' : '#ffd23f';
          ctx.fillText(e.automated ? 'AUTOMATED' : ('\u{1F465} ' + e.crew), e.x, by + 16);
          if (e.adrift) {
            ctx.fillStyle = '#39d5e8';
            ctx.fillText('ADRIFT — BOARDABLE', e.x, by + 28);
          } else if (e.empTimer > 0) {
            // weapons-arsenal: EMP stun indicator
            ctx.fillStyle = '#d28aff';
            ctx.fillText('⚡ STUNNED', e.x, by + 28);
          } else if (!e.automated && f < SF.CONFIG.crew.boardHullFrac) {
            ctx.fillStyle = '#ff9d5e';
            ctx.fillText('BOARDABLE [B]', e.x, by + 28);
          }
        }
      }
    }
  };
})();
/* ================= boss-encounters phase (2026-10-19) =================
 * SF.Bosses: one capital-ship boss per system (Solace Warden, Drift Marauder,
 * Ember Dreadnought). Large multi-turret ships with telegraphed attacks
 * (charge-up glow + warning line), DOM boss health bar (SF.BossBar in hud.js),
 * guaranteed rare drop + standing/karma reward on kill, 10-minute no-respawn
 * timer. Runtime-only, save-neutral (no save bump, timers in memory).
 *
 * Bosses live in SF.Enemies.list so the shared projectile / collision
 * plumbing just works; SF.Enemies delegates boss update / draw / kill here.
 * Boss AI follows the gameplay-depth juggernaut profile conventions: slow,
 * deliberate, holds range instead of strafing, never flees.
 */
window.SF = window.SF || {};

SF.Bosses = (function () {
  var RESPAWN_MS = 10 * 60 * 1000; // bosses do not respawn within 10 min of a kill
  var SPAWN_GRACE_S = 45;         // seconds in-system before the boss commits
  var SPAWN_DIST = 900;           // spawn distance from the player
  var killedAt = {};              // bossId -> Date.now() of kill (runtime only)
  var sysCache = null, sysTime = 0;

  function defs() { return (window.SF && SF.CONFIG && SF.CONFIG.bosses) || {}; }

  function defForSystem(systemId) {
    var d = defs();
    for (var k in d) if (d[k].systemId === systemId) return d[k];
    return null;
  }

  function bossIdOf(def) {
    var d = defs();
    for (var k in d) if (d[k] === def) return k;
    return null;
  }

  function anyAlive() {
    var l = SF.Enemies.list;
    for (var i = 0; i < l.length; i++) if (l[i].boss) return l[i];
    return null;
  }

  function canSpawn(bossId) {
    var t = killedAt[bossId];
    return !t || (Date.now() - t) >= RESPAWN_MS;
  }

  function spawnBoss(def, px, py) {
    var bossId = bossIdOf(def);
    var spec = (SF.CONFIG.enemies && SF.CONFIG.enemies[bossId]) || {};
    var diff = (SF.CONFIG.difficulty && SF.CONFIG.difficulty[SF.Game.systemId]) ||
      { dmgMul: 1 };
    var e = {
      type: bossId, spec: spec, boss: true, bossId: bossId, bossDef: def,
      x: px, y: py, vx: 0, vy: 0,
      angle: 0,
      hp: def.hp, maxHp: def.hp,
      radius: def.radius,
      dmgMul: diff.dmgMul,
      fireTimer: 0, fireInterval: 0,
      state: 'boss',
      contactTimer: 0, flash: 0,
      faction: null, playerAggro: false,
      automated: true, adrift: false, crew: 0,
      atkT: 2.5, atkIdx: 0, telegraph: null, // {kind, t, dur, ang}
      // boss-sfx-wiring: fight-phase marker — 0 = unengaged, 1-3 = current
      // phase. checkBossPhase() advances it on damage; see below.
      bossPhase: 0
    };
    SF.Enemies.list.push(e);
    SF.HUD.toast('\u26a0 CAPITAL SIGNATURE DETECTED \u2014 ' + def.title);
    return e;
  }

  /* boss-sfx-wiring (2026-10-21): 3-stage boss fight, SFX-only phase markers.
   * Additive and presentation-only — no AI / damage / reward changes, so no
   * balance impact. Each phase transition plays a banked sfx-bank-v6 id
   * (routed through SFX_FALLBACK by sfx-hooks-v6, so the synth fallback
   * covers a missing ogg) plus a HUD toast, so the player hears and sees
   * the fight escalate:
   *   phase 1: fight entry (first damage dealt to the boss)  -> boss_phase_shift_1
   *   phase 2: hp <= 66%                                     -> boss_phase_shift_2
   *   phase 3: hp <= 33%                                     -> boss_phase_shift_3
   * Defeat sting uses the banked killstreak_50 stinger (full detuned-saw
   * stinger + sub boom — the most defeat-like id in the v6 bank).
   * e.bossPhase is left on the entity for later phases that may want to
   * hang real AI or attack changes on it.
   * Ids are verbatim from phases/sfx-bank-v6/REPORT.md — zero invented ids. */
  var BOSS_PHASE_SFX = {
    1: 'boss_phase_shift_1',
    2: 'boss_phase_shift_2',
    3: 'boss_phase_shift_3'
  };
  var BOSS_DEFEAT_SFX = 'killstreak_50';

  function bossSfx(id) {
    // guarded: sfx() itself falls back to the routed synth when the ogg is
    // missing or undecodable, so a missing asset can never break the game.
    if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx(id);
  }

  function setBossPhase(e, phase) {
    if (e.bossPhase === phase) return;
    e.bossPhase = phase;
    bossSfx(BOSS_PHASE_SFX[phase]);
    var def = e.bossDef || {};
    if (window.SF && SF.HUD) SF.HUD.toast('\u26a0 ' + (def.title || 'BOSS') +
      ' \u2014 PHASE ' + phase);
  }

  function checkBossPhase(e) {
    // called from SF.Enemies.damage after hp drops; advances the phase
    // marker and fires the transition sfx exactly once per phase.
    if (!e || !e.boss || !e.maxHp) return;
    var frac = Math.max(0, e.hp) / e.maxHp;
    var phase = frac <= 1 / 3 ? 3 : (frac <= 2 / 3 ? 2 : 1);
    setBossPhase(e, phase);
  }

  /* ---------------- attack state machine ---------------- */

  function attackCooldown() { return 2.6 + Math.random() * 1.4; }

  function startAttack(e, player) {
    var def = e.bossDef;
    var kind = def.attacks[e.atkIdx % def.attacks.length];
    e.atkIdx++;
    var dur = def.telegraph + (kind === 'nova' ? 0.5 : 0) + (kind === 'lance' ? 0.3 : 0);
    // elite-enrage-phases: enraged bosses telegraph 20% shorter windups
    if (e.enraged) dur *= SF.ENRAGE.WINDUP_MUL;
    e.telegraph = {
      kind: kind, t: dur, dur: dur,
      ang: Math.atan2(player.y - e.y, player.x - e.x) // lance locks its line here
    };
  }

  function boltDmg(e) { return e.bossDef.boltDamage * (e.dmgMul || 1); }

  function turretPos(e, t) {
    var ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    return { x: e.x + t.x * ca - t.y * sa, y: e.y + t.x * sa + t.y * ca };
  }

  /* v2-fx-wiring: boss turret pad sprites (fx/turrets). Capital ships run
   * mixed armament, so hardpoints cycle laser/missile/plasma/railgun by
   * index. Called inside drawBoss's rotated frame (forward = +X; turret
   * art is top-down with the barrel up, hence the +PI/2 turn). Returns
   * true when at least one pad drew — the caller then skips its plain
   * barrel rects. Loader-null keeps the rects (b4: flash no longer does). */
  var BOSS_TURRET_SPRITES = ['laser', 'missile', 'plasma', 'railgun'];
  var bossTurretsWarmed = false;

  /* sprite-wiring-bosses: hull + charge-overlay sprites for the 3 bosses
   * (assets/sprites/bosses/<id>.png + <id>_charge.png, nose-up 512x512;
   * see phases/boss-sprites-1/REPORT.md). Warmed once on first boss sight so
   * the first telegraph doesn't frame-drop behind a fresh Image load.
   * Callers keep the procedural hull as fallback when get() returns null
   * (still loading or missing) — the game never breaks on a missing sprite. */
  var bossSpritesWarmed = false;

  function warmBossSprites() {
    if (bossSpritesWarmed || !(window.SF && SF.Sprites)) return;
    bossSpritesWarmed = true;
    var bIds = Object.keys((window.SF && SF.CONFIG && SF.CONFIG.bosses) || {});
    for (var i = 0; i < bIds.length; i++)
      SF.Sprites.preload('bosses', [bIds[i], bIds[i] + '_charge']);
    // b4-sprite-lighting: the enemies-kind boss _glow variants (shipped,
    // never requested by the boss renderer) are preloaded here too, so the
    // first boss sighting already has its glow ready.
    for (var j = 0; j < bIds.length; j++)
      SF.Sprites.preload('enemies', [bIds[j] + '_glow']);
  }

  /* b4-sprite-lighting: sprite-preserving hit flash (Bosses IIFE copy —
   * the Enemies IIFE above carries its own copy; the two IIFEs share no
   * scope). The old code forced the white procedural hull whenever
   * e.flash > 0, so a hit visibly downgraded a real ship to a polygon
   * for a frame. Instead the real sprite is always drawn and a cached
   * white silhouette of that exact sprite (alpha mask filled white, one
   * offscreen canvas per sprite id) is stamped over it at the same
   * geometry while flashing. Loader-null still falls back to the
   * procedural hull (white when flashing), so a missing sprite never
   * blanks. Cache is bounded by the sprite id set (tens of entries);
   * entries are never evicted because boss/enemy sprite ids are a fixed
   * shipped set. */
  var whiteCache = {};
  function whiteSilhouette(img) {
    var key = img.src || '';
    if (whiteCache[key]) return whiteCache[key];
    var w = img.naturalWidth || img.width || 64,
        h = img.naturalHeight || img.height || 64;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    whiteCache[key] = c;
    return c;
  }

  function drawBossTurretPads(ctx, def) {
    // b4-sprite-lighting: no flash bail-out any more — pads are sprites,
    // and the sprite-preserving flash stamps its white silhouette over
    // the whole boss (pads included) instead of swapping in rects.
    if (!(window.SF && SF.Sprites)) return false;
    if (!bossTurretsWarmed) {
      bossTurretsWarmed = true;
      SF.Sprites.preload('fx/turrets', BOSS_TURRET_SPRITES);
    }
    var drew = false;
    for (var i = 0; i < def.turrets.length; i++) {
      var t = def.turrets[i];
      var img = SF.Sprites.get('fx/turrets', BOSS_TURRET_SPRITES[i % BOSS_TURRET_SPRITES.length]);
      if (!img) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -13, -13, 26, 26);
      ctx.restore();
      drew = true;
    }
    return drew;
  }

  function fireAttack(e, player) {
    var def = e.bossDef, tel = e.telegraph, kind = tel.kind, i, a;
    if (kind === 'volley') {
      // every turret fires an aimed bolt (charge-up glow shown at the ports)
      for (i = 0; i < def.turrets.length; i++) {
        var p = turretPos(e, def.turrets[i]);
        a = Math.atan2(player.y - p.y, player.x - p.x) + (Math.random() - 0.5) * 0.08;
        SF.Projectiles.spawn(p.x, p.y, a, def.boltSpeed, boltDmg(e),
          false, def.color, { radius: 5, life: 4 });
      }
    } else if (kind === 'lance') {
      // capital railgun along the locked warning line
      var lx = e.x + Math.cos(tel.ang) * (e.radius + 10);
      var ly = e.y + Math.sin(tel.ang) * (e.radius + 10);
      SF.Projectiles.spawn(lx, ly, tel.ang, 1100, boltDmg(e) * 6,
        false, def.glowColor, { radius: 7, life: 1.8 });
      SF.Particles.burst(lx, ly, def.glowColor, 12, 260, 0.4, 3);
      if (window.SF && SF.FX) SF.FX.shake(6);
    } else if (kind === 'salvo') {
      // homing missile fan from alternating turret ports
      for (i = 0; i < 5; i++) {
        var p2 = turretPos(e, def.turrets[i % def.turrets.length]);
        a = e.angle + (i - 2) * 0.35;
        SF.Projectiles.spawn(p2.x, p2.y, a, def.boltSpeed * 0.8, boltDmg(e) * 2,
          false, '#ff9d5e', { radius: 5, homing: true, turn: 2.2, life: 4, target: player });
      }
    } else if (kind === 'nova') {
      // radial bullet ring (telegraphed by the expanding warning ring)
      var n = 18;
      for (i = 0; i < n; i++) {
        a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
        SF.Projectiles.spawn(e.x, e.y, a, 260, boltDmg(e) * 1.5,
          false, def.color, { radius: 5, life: 4 });
      }
      if (window.SF && SF.FX) SF.FX.shake(8);
    }
    SF.Audio.enemyLaser();
  }

  return {
    /* ---- spawn scheduler: called from SF.Enemies.update (PLAYING only) ---- */
    tick: function (dt, player, worldSize) {
      var sys = SF.Game.systemId;
      if (sys !== sysCache) { sysCache = sys; sysTime = 0; }
      sysTime += dt;
      // early-game-difficulty-1: NO capital boss in rookie Solace. The
      // Solace Warden (boltDamage 10, 1500hp) committing 45s into a Lv1
      // pilot's first flight is the exact death the user reported. The
      // boss returns the moment the pilot outgrows the window (Lv3+);
      // Drift/Ember bosses are never rookie-gated (factor is Solace-only).
      if (window.SF && SF.Enemies && SF.Enemies.rookieFactor &&
          SF.Enemies.rookieFactor(sys).active) return;
      if (sysTime < SPAWN_GRACE_S) return; // let the player settle in first
      if (anyAlive()) return;             // one boss at a time per system
      var def = defForSystem(sys);
      if (!def) return;
      var bossId = bossIdOf(def);
      if (!canSpawn(bossId)) return;      // 10-minute no-respawn window
      var a = Math.random() * Math.PI * 2;
      // open-space-1: bosses spawn near the player, wherever that is.
      var x = player.x + Math.cos(a) * SPAWN_DIST;
      var y = player.y + Math.sin(a) * SPAWN_DIST;
      spawnBoss(def, x, y);
    },

    /* ---- boss AI: juggernaut-style — slow traverse, hold range, never flee ---- */
    updateBoss: function (dt, e, player, worldSize) {
      var def = e.bossDef;
      // elite-enrage-phases: pulsing red particle aura while enraged
      // (auraTick lives on SF.Enemies — separate closure from SF.Bosses)
      if (window.SF && SF.Enemies && SF.Enemies.auraTick)
        SF.Enemies.auraTick(e, dt);
      var dx = player.x - e.x, dy = player.y - e.y;
      var dist = Math.hypot(dx, dy) || 1;
      var nx = dx / dist, ny = dy / dist;
      // slow capital-ship traverse toward the player
      var want = Math.atan2(dy, dx), d = want - e.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      var turn = 1.1 * dt;
      e.angle += Math.max(-turn, Math.min(turn, d));
      // hold range: close in from far out, back off when crowded
      // elite-enrage-phases: enraged bosses move 20% faster (bossSpeedMul)
      var sp = def.speed * (e.bossSpeedMul || 1), ax = 0, ay = 0;
      if (dist > 560) { ax = nx * sp; ay = ny * sp; }
      else if (dist < 320) { ax = -nx * sp * 0.6; ay = -ny * sp * 0.6; }
      var k = Math.min(1, 1.5 * dt);
      e.vx += (ax - e.vx) * k; e.vy += (ay - e.vy) * k;
      e.x += e.vx * dt; e.y += e.vy * dt;
        // open-space-1: no wall clamp — flight is unbounded.
      // contact damage (capital ramming hurts)
      if (dist < e.radius + player.radius && e.contactTimer <= 0) {
        e.contactTimer = SF.CONFIG.player.contactCooldown;
        player.takeDamage(def.contact * (e.dmgMul || 1));
      }
      // telegraphed attack cycle
      if (e.telegraph) {
        e.telegraph.t -= dt;
        if (e.telegraph.t <= 0) {
          fireAttack(e, player);
          e.telegraph = null;
          // elite-enrage-phases: enraged bosses attack 35% faster (x0.65)
          e.atkT = attackCooldown() * (e.enraged ? SF.ENRAGE.FIRE_MUL : 1);
        }
      } else {
        e.atkT -= dt;
        if (e.atkT <= 0) startAttack(e, player);
      }
    },

    /* ---- boss kill: guaranteed rare drop + standing/karma reward, no-respawn ---- */
    onKill: function (e) {
      var def = e.bossDef;
      killedAt[e.bossId] = Date.now();
      SF.Particles.explosion(e.x, e.y, 3.0);
      if (window.SF && SF.FX) SF.FX.shake(16);
      SF.Audio.explosion(true);
      // boss-sfx-wiring: boss-defeat sting (banked killstreak_50, sfx-bank-v6).
      bossSfx(BOSS_DEFEAT_SFX);
      var cr = def.creditReward[0] +
        Math.floor(Math.random() * (def.creditReward[1] - def.creditReward[0] + 1));
      SF.Pickups.spawnCredits(e.x, e.y, cr);
      SF.Pickups.spawnItem(e.x, e.y, def.dropItem);     // guaranteed rare drop
      SF.Pickups.spawnWeapon(e.x, e.y, def.dropWeapon); // guaranteed rare weapon
      if (window.SF && SF.Factions) {
        SF.Factions.shift(def.standFaction, def.stand);
        SF.Factions.shiftKarma(def.karma);
      }
      SF.HUD.toast('\u2620 ' + def.name + ' DESTROYED \u2014 +' + cr + 'c, ' +
        SF.FACTION_BY_ID[def.standFaction].name + ' +' + def.stand + ' standing');
      if (window.SF && SF.News) SF.News.push('\u2620 ' + def.name + ' destroyed in ' +
        SF.SYSTEM_BY_ID[def.systemId].name + '. The sector breathes easier.');
    },

    /* ---- capital-ship renderer + attack telegraphs ---- */
    drawBoss: function (ctx, e) {
      var def = e.bossDef, R = e.radius, i;
      var flash = e.flash > 0;
      warmBossSprites();
      /* b-perf: hull cull with the same split as Enemies.draw — the hull
       * block (sprite + glow + charge + pads + flash) is skipped when
       * the hull footprint is offscreen, while the name tag and the
       * attack telegraphs below (lance line to 1200px, nova ring) still
       * draw. On s25 the additive _glow stamp is skipped (hull +
       * charge + flash remain). The opening save/translate/rotate is
       * balanced on every path (skip path restores immediately). */
      var bView = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var bVis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      var bS25 = !!(window.SF && SF.FX && SF.FX.getEffective &&
                    SF.FX.getEffective() === 's25');
      var hullOnScreen = !bVis || bVis(bView, e.x, e.y, R + 30);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      // sprite-wiring-bosses: 512x512 boss hull sprite from the dedicated
      // bosses/ kind (same nose-up convention as the enemies/-kind set it
      // replaced; see phases/boss-sprites-1/REPORT.md 'wiring hook points').
      // Telegraph warning lines, the name tag and turret charge glows are
      // drawn on top outside this rotated block; the additive _charge
      // overlay lives inside it. b4-sprite-lighting: flash no longer
      // forces the procedural hull — the sprite draws and a white
      // silhouette of it is stamped over it below while flashing.
      // Missing sprite keeps the procedural hull.
      var spr = (window.SF && SF.Sprites) ?
        SF.Sprites.get('bosses', e.bossId) : null;
      if (!hullOnScreen) { ctx.restore(); }
      else if (spr) {
        var sbs = 2 * R;
        /* twelve-hour-wave4 readability: halo disc under the boss hull
         * (fill only, no extra drawImage), same as the enemy pass. */
        ctx.fillStyle = 'rgba(4,8,18,0.50)';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.1, 0, Math.PI * 2); ctx.fill();
        // b4-sprite-lighting: boss engine glow — the enemies-kind
        // <id>_glow variants shipped but were never requested by the boss
        // renderer (baseline §1.1: no boss _glow files in bosses/). The
        // glow art covers the hull footprint at the same transform (0°
        // best-match IoU vs the bosses-kind hull, measured on disk), and
        // as additive light it tolerates the hull-art difference. Drawn
        // UNDER the hull like the enemy glow pass. During a telegraph
        // the glow brightens with the wind-up fraction so the charge
        // state reads even before the _charge overlay peaks.
        var bglow = (window.SF && SF.Sprites) ?
          SF.Sprites.get('enemies', e.bossId + '_glow') : null;
        if (bglow && !bS25) {
          var telFrac = e.telegraph && e.telegraph.dur > 0 ?
            1 - e.telegraph.t / e.telegraph.dur : 0;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = e.telegraph ?
            Math.min(1, 0.6 + 0.4 * telFrac) :
            0.45 + 0.25 * Math.sin(Date.now() / 180);
          ctx.drawImage(bglow, -sbs / 2, -sbs / 2, sbs, sbs);
          ctx.restore();
        }
        ctx.drawImage(spr, -sbs / 2, -sbs / 2, sbs, sbs);
        // sprite-wiring-bosses: telegraph charge-up — the <id>_charge
        // variant drawn additively over the base sprite while e.telegraph
        // is set, alpha pulsing on the telegraph fraction. Skipped when the
        // charge sprite is null/loading (loader fallback contract).
        if (e.telegraph) {
          var tel = e.telegraph,
              frac = tel.dur > 0 ? 1 - tel.t / tel.dur : 0;
          var chargeSpr = SF.Sprites.get('bosses', e.bossId + '_charge');
          if (chargeSpr) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(1, Math.max(0.05,
              0.35 + 0.55 * frac + 0.1 * Math.sin(Date.now() / 110)));
            ctx.drawImage(chargeSpr, -sbs / 2, -sbs / 2, sbs, sbs);
            ctx.restore();
          }
        }
        // b4-sprite-lighting: the old procedural engine ellipse double-drew
        // over the sprite; it now runs ONLY when the glow sprite is not
        // ready (loader-null fallback), never on top of ready glow art.
        if (!bglow) {
          var egS = 0.5 + 0.5 * Math.sin(Date.now() / 180);
          ctx.fillStyle = 'rgba(255,150,60,' + (0.35 + 0.4 * egS).toFixed(2) + ')';
          ctx.beginPath();
          ctx.ellipse(-R * 1.05, 0, 10 + 6 * egS, 16, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // v2-fx-wiring: turret pad sprites on the hardpoints
        drawBossTurretPads(ctx, def);
        // b4-sprite-lighting: sprite-preserving flash — white silhouette
        // of the exact hull at the same geometry.
        if (flash) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.drawImage(whiteSilhouette(spr), -sbs / 2, -sbs / 2, sbs, sbs);
          ctx.restore();
        }
        ctx.restore();
      } else {
      // dark armored wedge
      ctx.fillStyle = flash ? '#fff' : '#1a2233';
      ctx.beginPath();
      ctx.moveTo(R * 1.1, 0);
      ctx.lineTo(-R * 0.7, -R * 0.75); ctx.lineTo(-R * 1.0, -R * 0.4);
      ctx.lineTo(-R * 1.0, R * 0.4); ctx.lineTo(-R * 0.7, R * 0.75);
      ctx.closePath(); ctx.fill();
      // faction-color plating
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = flash ? '#fff' : def.color;
      ctx.beginPath();
      ctx.moveTo(R * 0.9, 0);
      ctx.lineTo(-R * 0.5, -R * 0.5); ctx.lineTo(-R * 0.8, -R * 0.28);
      ctx.lineTo(-R * 0.8, R * 0.28); ctx.lineTo(-R * 0.5, R * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      // glowing spine stripe
      ctx.fillStyle = flash ? '#fff' : def.glowColor;
      ctx.fillRect(-R * 0.8, -3, R * 1.4, 6);
      // turret barrels — v2-fx-wiring: pad sprites first, rects on fallback
      if (!drawBossTurretPads(ctx, def)) {
        ctx.fillStyle = flash ? '#fff' : '#0c1220';
        for (i = 0; i < def.turrets.length; i++) {
          var t = def.turrets[i];
          ctx.fillRect(t.x - 3, t.y - 3, 12, 6);
        }
      }
      // engine glow
      var eg = 0.5 + 0.5 * Math.sin(Date.now() / 180);
      ctx.fillStyle = 'rgba(255,150,60,' + (0.35 + 0.4 * eg).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(-R * 1.05, 0, 10 + 6 * eg, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      }
      // name tag
      ctx.save();
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5e3a';
      ctx.fillText('\u26a0 ' + def.title, e.x, e.y - e.radius - 14);
      // elite-enrage-phases: red pulsing enrage ring around the capital ship
      if (e.enrageAura) {
        var bp = 0.5 + 0.5 * Math.sin(Date.now() / 140);
        ctx.save();
        ctx.strokeStyle = '#ff2a2a';
        ctx.globalAlpha = 0.6 + 0.35 * bp;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, R + 24 + bp * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#ff2a2a';
        ctx.fillText('\u{1F525} ENRAGED', e.x, e.y - e.radius - 32);
      }
      ctx.restore();
      // attack telegraphs
      if (e.telegraph) {
        var tel = e.telegraph, frac = 1 - tel.t / tel.dur;
        var ca = Math.cos(e.angle), sa = Math.sin(e.angle);
        ctx.save();
        if (tel.kind === 'lance') {
          // warning line along the locked angle
          var lx = Math.cos(tel.ang), ly = Math.sin(tel.ang);
          ctx.strokeStyle = 'rgba(255,60,40,' + (0.35 + 0.45 * frac).toFixed(2) + ')';
          ctx.lineWidth = 4; ctx.setLineDash([14, 10]);
          ctx.beginPath();
          ctx.moveTo(e.x + lx * e.radius, e.y + ly * e.radius);
          ctx.lineTo(e.x + lx * 1200, e.y + ly * 1200);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ff5e3a';
          ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
          ctx.fillText('\u26a0', e.x + lx * (e.radius + 60), e.y + ly * (e.radius + 60));
        } else if (tel.kind === 'nova') {
          // expanding warning ring
          ctx.strokeStyle = 'rgba(255,90,50,' + (0.3 + 0.5 * frac).toFixed(2) + ')';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius + frac * 160, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // volley / salvo: charge-up glow on the turret ports
          for (var j = 0; j < def.turrets.length; j++) {
            var tt = def.turrets[j];
            var wx = e.x + tt.x * ca - tt.y * sa, wy = e.y + tt.x * sa + tt.y * ca;
            var gr = 8 + frac * 14;
            var g = ctx.createRadialGradient(wx, wy, 0, wx, wy, gr);
            g.addColorStop(0, def.glowColor);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.35 + 0.55 * frac;
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(wx, wy, gr, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.restore();
      }
    },

    /* ---- query / test hooks ---- */
    anyAlive: anyAlive,
    canSpawn: canSpawn,
    respawnMs: function () { return RESPAWN_MS; },
    spawnFor: function (systemId, px, py) { // test/debug hook: force a spawn
      var def = defForSystem(systemId);
      return def ? spawnBoss(def, px, py) : null;
    },
    forceTelegraph: function (kind) { // test hook: start a named attack now
      var b = anyAlive();
      if (!b) return false;
      b.telegraph = { kind: kind, t: 0.6, dur: 0.6,
        ang: Math.atan2(SF.Player.y - b.y, SF.Player.x - b.x) };
      return true;
    },
    /* v2-fx-wiring: boss hardpoint sprite hook (smoke tests) */
    turretSpriteFor: function (i) { return BOSS_TURRET_SPRITES[i % BOSS_TURRET_SPRITES.length]; },
    /* boss-sfx-wiring: damage hook entry — SF.Enemies.damage calls this
     * after each hit so the fight-phase marker advances and the transition
     * sfx fires exactly once per phase. Exposed for tests. */
    checkBossPhase: checkBossPhase
  };
})();

/* ================= enemy-elites phase (2026-10-19) =================
 * SF.Elites: elite enemy variants — Fast / Bulwark / Swarmlord.
 *
 *   Fast      speed +40%, hull -20%   (aura cyan    #39d5e8)
 *   Bulwark   hull  +80%, speed -20%  (aura orange  #ff9d5e)
 *   Swarmlord hull  +30%, spawns 3 adds on death (aura violet #b45cff)
 *
 * Elites are named (e.g. 'Vex the Quick'), fly a colored pulsing aura ring,
 * drop better loot (elite weapon/mod rolls via the weapons-arsenal drop logic
 * + guaranteed elite-weighted component + rare-part roll + credit bonus),
 * and their kills grant +standing with the local faction plus a kill banner.
 *
 * RUNTIME-ONLY, SAVE-NEUTRAL: no save blob changes, no SAVE_VERSION bump.
 * Aura visuals are plain canvas primitives in SF.Enemies.draw — js/particles.js
 * is deliberately untouched (outside this phase's scope).
 */
window.SF = window.SF || {};

SF.Elites = (function () {
  var usedNames = {}; // per-session dedupe so elites in one session feel unique

  function rateFor(systemId) {
    return (SF.CONFIG.eliteRate && SF.CONFIG.eliteRate[systemId]) || 0;
  }

  return {
    /* elite roll for a normal patrol spawn (null = no elite). Weighted so
     * each variant shows up: Fast 40% / Bulwark 40% / Swarmlord 20%. */
    roll: function (systemId) {
      // early-game-difficulty-1: structural rookie gate — no elites in
      // the window regardless of the configured rate (defense in depth
      // alongside the spawnPatrol gate; covers direct roll() callers).
      if (window.SF && SF.Enemies && SF.Enemies.rookieFactor &&
          SF.Enemies.rookieFactor(systemId).active) return null;
      var rate = rateFor(systemId);
      if (!(rate > 0) || Math.random() >= rate) return null;
      var r = Math.random();
      if (r < 0.4) return 'fast';
      if (r < 0.8) return 'bulwark';
      return 'swarmlord';
    },

    rate: rateFor,

    /* unique-ish name for an elite of a variant (falls back to variant name) */
    pickName: function (variantId) {
      var v = SF.ELITE_VARIANTS && SF.ELITE_VARIANTS[variantId];
      if (!v) return variantId;
      for (var tries = 0; tries < 3; tries++) {
        var n = v.names[Math.floor(Math.random() * v.names.length)];
        if (!usedNames[n]) { usedNames[n] = true; return n; }
      }
      return v.names[Math.floor(Math.random() * v.names.length)];
    },

    /* test hook: force-spawn an elite variant */
    spawn: function (typeId, x, y, mul, variantId, opts) {
      opts = opts || {};
      opts.elite = variantId;
      return SF.Enemies.spawn(typeId, x, y, mul, opts);
    },

    /* test hook: true when the elite aura tag would draw for e */
    hasAura: function (e) { return !!(e && e.elite && e.eliteDef && e.eliteDef.aura); }
  };
})();

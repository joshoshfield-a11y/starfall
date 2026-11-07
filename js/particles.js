/* STARFALL Phase 1 — particles.js
 * Fixed-size particle pool for explosions, sparks, thrusters. Additive glow draw.
 *
 * graphics-juice: extended (API-compatible). Adds:
 *  - particle kinds: 'rect' (default) and 'ring' (expanding shockwave)
 *  - setQualityScale(f): scales spawn counts in the new emitters (Low = 0.35)
 *  - explosion(x,y,scale), thrust(x,y,angle), sparks(x,y,color), muzzle(x,y,color)
 *  - activeCount() for smoke tests
 * Original burst(x,y,color,n,speed,life,size) API unchanged.
 * balance-perf: cursor spawn (amortized O(1)), allocation-free batched draw
 * (one fill/stroke per color+alpha bucket, additive pass preserved).
 */
window.SF = window.SF || {};

SF.Particles = (function () {
  var POOL = 512;
  var pool = [];
  var cursor = 0; // spawn scan cursor
  var qScale = 1; // graphics-juice: quality multiplier for emitter counts

  function make() {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
             size: 2, color: '#fff', drag: 0, kind: 'rect' };
  }

  function qn(n) { return Math.max(1, Math.round(n * qScale)); }

  /* ---- v2-fx-wiring: explosion sprite overlays ----
   * explosion() keeps its layered particle burst; in addition it stamps
   * short-lived sprite overlays from assets/sprites/fx/explosions/: a main
   * burst sprite (size class small/medium/large, or 'ion' for EMP-flavoured
   * detonations), a 'shockwave' ring, and a 'smoke' puff. Overlays live in
   * their own fixed pool — presentation only, they never touch the
   * particle pool or any simulation state. A null from SF.Sprites (still
   * loading / missing file) simply skips the stamp, so the fallback is
   * exactly the original procedural explosion. */
  var EXP_POOL = 24;
  var expPool = [];
  for (var ei = 0; ei < EXP_POOL; ei++) {
    expPool.push({ active: false, x: 0, y: 0, life: 0, maxLife: 1,
                   size: 60, id: 'medium', layer: 'main', rot: 0 });
  }
  var expCursor = 0;
  var EXP_IDS = ['small', 'medium', 'large', 'ion', 'shockwave', 'smoke'];
  var expPreloaded = false;

  function preloadExpSprites() {
    if (expPreloaded) return;
    expPreloaded = true;
    if (window.SF && SF.Sprites) SF.Sprites.preload('fx/explosions', EXP_IDS);
  }

  function explosionIdFor(scale, ion) {
    if (ion) return 'ion';
    return scale < 1.1 ? 'small' : (scale < 1.9 ? 'medium' : 'large');
  }

  function stamp(x, y, id, layer, size, life, dir) {
    var slot = expCursor;
    var o = expPool[slot];
    expCursor = (expCursor + 1) % EXP_POOL;
    o.active = true;
    o.x = x; o.y = y;
    o.id = id; o.layer = layer;
    o.dir = dir || 'fx/explosions';
    o.size = size; o.maxLife = life; o.life = life;
    o.rot = Math.random() * Math.PI * 2;
    return slot;
  }

  /* ---- b1-wire-fx: shipped-but-unwired FX art ----
   * Same loader (SF.Sprites) and same 24-slot overlay pool as the
   * explosion stamps above — no new loader, no new pool, so the total
   * sprite-overlay drawImage count stays bounded by EXP_POOL. Every
   * emitter below REPLACES its procedural burst when its sprite is
   * ready (loader non-null) and keeps the exact old burst as fallback
   * when the file is still loading or missing — never a blank flash.
   * Muzzle art is radial (verified on disk), so no aim rotation is
   * applied; spark art gets the same random rotation as explosions.
   * Trail uses ONE refreshed slot per thrusting ship instead of a
   * stream of stamps: thrust() re-arms the same slot while the engine
   * runs, so a thrusting ship costs at most 1 overlay drawImage. */
  var MUZZLE_IDS = ['beam', 'bolt', 'emp', 'flak', 'lance', 'mine', 'plasma', 'torpedo'];
  var TRAIL_IDS = ['puff-amber', 'puff-cyan', 'puff-teal', 'puff-violet'];
  var SPARK_IDS = ['spark-acid', 'spark-crimson', 'spark-cyan', 'spark-ember', 'spark-gold', 'spark-violet'];
  var SHIELD_IDS = ['ring-cyan', 'ring-magenta', 'ring-teal'];
  var fxPreloaded = false;
  var trailSlot = -1;

  /* twelve-hour-wave2: explosion staging — flash -> debris -> fade. The
   * immediate bursts + stamps are the flash; a small dark-ember debris
   * burst is queued and fires from update() 0.28s later, then the long
   * smoke (1.1s life) is the fade. Queue capped at 8, pooled particles
   * only, quality-scaled like every other burst; clear() drains it. */
  var debrisQueue = []; // {t, x, y, scale}
  var DEBRIS_DELAY = 0.28;

  function preloadFxSprites() {
    if (fxPreloaded) return;
    fxPreloaded = true;
    if (window.SF && SF.Sprites) {
      SF.Sprites.preload('fx/muzzle', MUZZLE_IDS);
      SF.Sprites.preload('fx/trail', TRAIL_IDS);
      SF.Sprites.preload('fx/sparks', SPARK_IDS);
      SF.Sprites.preload('fx/shield', SHIELD_IDS);
    }
  }

  /* Weapon projectile kind -> muzzle art. Every shipped muzzle id is
   * used: bolt/beam direct, pellet spread -> flak, orb plasma -> plasma,
   * slug rail -> lance, missile launch -> torpedo, mine layer -> mine,
   * emp -> emp, starfall -> plasma. Unknown kinds fall back to bolt. */
  function muzzleIdFor(kind) {
    switch (String(kind || '')) {
      case 'beam': return 'beam';
      case 'pellet': return 'flak';
      case 'orb': return 'plasma';
      case 'emp': return 'emp';
      case 'slug': return 'lance';
      case 'missile': return 'torpedo';
      case 'mine': return 'mine';
      case 'starfall': return 'plasma';
      default: return 'bolt';
    }
  }

  /* Damage/energy color -> spark art. Known caller colors first, then a
   * hue bucket fallback so any future color still maps sensibly. */
  function sparkIdFor(color) {
    var c = String(color || '').toLowerCase();
    if (c === '#ffd23f') return 'spark-gold';
    if (c === '#7dff8a') return 'spark-acid';
    if (c === '#ff8c2e') return 'spark-ember';
    if (c === '#3fa9ff' || c === '#7df9ff') return 'spark-cyan';
    if (c === '#ff2a2a' || c === '#ff5e3a') return 'spark-crimson';
    if (c === '#b45cff' || c === '#d28aff') return 'spark-violet';
    var m = /^#([0-9a-f]{6})$/.exec(c);
    if (!m) return 'spark-gold';
    var r = parseInt(m[1].slice(0, 2), 16) / 255,
        g = parseInt(m[1].slice(2, 4), 16) / 255,
        b = parseInt(m[1].slice(4, 6), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), hue = 0;
    if (mx !== mn) {
      var d = mx - mn;
      hue = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60
        : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    }
    if (hue < 15 || hue >= 345) return 'spark-crimson';
    if (hue < 45) return 'spark-ember';
    if (hue < 75) return 'spark-gold';
    if (hue < 160) return 'spark-acid';
    if (hue < 200) return 'spark-cyan';
    return 'spark-violet';
  }

  function spriteReady(dir, id) {
    return !!(window.SF && SF.Sprites) && !!SF.Sprites.get(dir, id);
  }

  /* ---- allocation-free draw buckets (same scheme as projectiles.js) ---- */
  var QN = 512, AN = 64;
  var fillBk = {}, strokeBk = {};
  var fillUsed = [], strokeUsed = [];

  function fbucket(key) {
    var b = fillBk[key];
    if (!b) { b = fillBk[key] = { q: new Float32Array(QN * 8), nq: 0, a: new Float32Array(AN * 3), na: 0 }; fillUsed.push(key); }
    else if (b.nq === 0 && b.na === 0) fillUsed.push(key);
    return b;
  }
  function sbucket(key) {
    var b = strokeBk[key];
    if (!b) { b = strokeBk[key] = { q: new Float32Array(QN * 8), nq: 0, a: new Float32Array(AN * 3), na: 0 }; strokeUsed.push(key); }
    else if (b.nq === 0 && b.na === 0) strokeUsed.push(key);
    return b;
  }
  function qkey(color, alpha) {
    var q = (alpha * 8) | 0; if (q > 7) q = 7; if (q < 0) q = 0;
    return color + '|' + q;
  }
  function pushRect(b, x, y, s) {
    if (b.nq >= QN) return;
    var o = b.nq * 8, q = b.q, h = s / 2;
    q[o] = x - h; q[o+1] = y - h; q[o+2] = x + h; q[o+3] = y - h;
    q[o+4] = x + h; q[o+5] = y + h; q[o+6] = x - h; q[o+7] = y + h;
    b.nq++;
  }
  function pushArc(b, x, y, r) {
    if (b.na >= AN) return;
    var o = b.na * 3, a = b.a;
    a[o] = x; a[o+1] = y; a[o+2] = r;
    b.na++;
  }
  function flushFill(ctx) {
    for (var i = 0; i < fillUsed.length; i++) {
      var key = fillUsed[i], b = fillBk[key];
      var sep = key.lastIndexOf('|');
      ctx.globalAlpha = (+key.slice(sep + 1)) / 7;
      ctx.fillStyle = key.slice(0, sep);
      ctx.beginPath();
      var q = b.q;
      for (var k = 0; k < b.nq; k++) {
        var o = k * 8;
        // rects are axis-aligned: emit as rect() for the fast path
        ctx.rect(q[o], q[o+1], q[o+2] - q[o], q[o+5] - q[o+1]);
      }
      var ar = b.a;
      for (var j = 0; j < b.na; j++) {
        var p = j * 3;
        ctx.moveTo(ar[p] + ar[p+2], ar[p+1]);
        ctx.arc(ar[p], ar[p+1], ar[p+2], 0, Math.PI * 2);
      }
      ctx.fill();
      b.nq = 0; b.na = 0;
    }
    fillUsed.length = 0;
  }
  function flushStroke(ctx) {
    for (var i = 0; i < strokeUsed.length; i++) {
      var key = strokeUsed[i], b = strokeBk[key];
      var sep = key.lastIndexOf('|');
      ctx.globalAlpha = (+key.slice(sep + 1)) / 7;
      ctx.strokeStyle = key.slice(0, sep);
      ctx.lineWidth = 3;
      ctx.beginPath();
      var ar = b.a;
      for (var j = 0; j < b.na; j++) {
        var p = j * 3;
        ctx.moveTo(ar[p] + ar[p+2], ar[p+1]);
        ctx.arc(ar[p], ar[p+1], ar[p+2], 0, Math.PI * 2);
      }
      ctx.stroke();
      b.nq = 0; b.na = 0;
    }
    strokeUsed.length = 0;
  }

  /* Claim the next free slot (cursor scan). Returns null when pool is full. */
  function claim() {
    var n = pool.length, i = cursor;
    for (var k = 0; k < n; k++) {
      var p = pool[i];
      if (++i >= n) i = 0;
      if (!p.active) { cursor = i; return p; }
    }
    cursor = i;
    return null;
  }

  /* Spawn a single fully-specified particle. Returns false when pool is full. */
  function spawnOne(x, y, vx, vy, color, size, life, drag, kind) {
    var p = claim();
    if (!p) return false;
    p.active = true;
    p.x = x; p.y = y;
    p.vx = vx; p.vy = vy;
    p.maxLife = life; p.life = life;
    p.color = color; p.size = size;
    p.drag = drag; p.kind = kind || 'rect';
    return true;
  }

  return {
    init: function () {
      pool.length = 0;
      for (var i = 0; i < POOL; i++) pool.push(make());
      cursor = 0;
    },

    clear: function () {
      for (var i = 0; i < pool.length; i++) pool[i].active = false;
      cursor = 0;
      for (var j = 0; j < expPool.length; j++) expPool[j].active = false;
      trailSlot = -1; // b1-wire-fx: drop the refreshed trail slot
      debrisQueue.length = 0; // twelve-hour-wave2: drop staged debris
    },

    /* twelve-hour-wave2: staged debris queue depth (smoke-test hook). */
    debrisPending: function () { return debrisQueue.length; },

    /* graphics-juice: quality scale for the new emitters (Low tier = 0.35). */
    setQualityScale: function (f) { qScale = f; },
    getQualityScale: function () { return qScale; },

    burst: function (x, y, color, n, speed, life, size) {
      // single cursor scan pass (branch wrap, no per-particle call overhead)
      var spawned = 0, pl = pool.length, i = cursor;
      for (var k = 0; k < pl && spawned < n; k++) {
        var p = pool[i];
        if (++i >= pl) i = 0;
        if (p.active) continue;
        var a = Math.random() * Math.PI * 2;
        var s = speed * (0.3 + Math.random() * 0.7);
        p.active = true;
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
        p.maxLife = life * (0.6 + Math.random() * 0.6); p.life = p.maxLife;
        p.color = color; p.size = size * (0.6 + Math.random() * 0.8);
        p.drag = 2.2; p.kind = 'rect';
        spawned++;
      }
      cursor = i;
    },

    /* Layered explosion: white-hot core flash + fire + embers + smoke + shockwave ring.
     * v2-fx-wiring: also stamps the fx/explosions sprite set (main burst by
     * size class, shockwave ring, smoke puff). `ion` = EMP-flavoured blast. */
    explosion: function (x, y, scale, ion) {
      scale = scale || 1;
      this.burst(x, y, '#fff8e8', qn(8 * scale), 60, 0.25, 7 * scale);
      this.burst(x, y, '#ff8c2e', qn(14 * scale), 260 * scale, 0.7, 5 * scale);
      this.burst(x, y, '#ffd23f', qn(8 * scale), 200 * scale, 0.5, 4 * scale);
      this.burst(x, y, '#5a5a6e', qn(6 * scale), 90 * scale, 1.1, 6 * scale);
      spawnOne(x, y, 0, 0, 'rgba(255,240,200,0.85)', 10 * scale, 0.45, 0, 'ring');
      preloadExpSprites();
      var d = 120 * scale;
      stamp(x, y, explosionIdFor(scale, ion), 'main', d, 0.45);
      stamp(x, y, 'shockwave', 'wave', d * 1.25, 0.6);
      /* b-perf: the slow smoke puff is the most cosmetic of the three
       * stamps; on s25 it is skipped (main burst + shockwave remain). */
      var s25exp = !!(window.SF && SF.FX && SF.FX.getEffective &&
                      SF.FX.getEffective() === 's25');
      if (!s25exp) stamp(x, y, 'smoke', 'smoke', d * 0.9, 1.05);
      if (debrisQueue.length < 8)
        debrisQueue.push({ t: DEBRIS_DELAY, x: x, y: y, scale: scale });
    },

    /* Engine trail puff behind the ship nose angle.
     * b1-wire-fx: when the puff sprite is ready, one refreshed overlay
     * slot replaces the particle stream (see trailSlot note above);
     * otherwise the exact old particle. Variant defaults to amber
     * (player engine); callers may pass a fx/trail id. */
    thrust: function (x, y, angle, variant) {
      preloadFxSprites();
      var id = (variant && TRAIL_IDS.indexOf(variant) >= 0) ? variant : 'puff-amber';
      if (spriteReady('fx/trail', id)) {
        var o = (trailSlot >= 0) ? expPool[trailSlot] : null;
        if (o && o.active && o.layer === 'trail') {
          o.x = x; o.y = y; o.life = o.maxLife;
        } else {
          trailSlot = stamp(x, y, id, 'trail', 26, 0.4, 'fx/trail');
        }
        return;
      }
      var back = angle + Math.PI;
      var a = back + (Math.random() - 0.5) * 0.5;
      var sp = 60 + Math.random() * 80;
      spawnOne(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        Math.random() < 0.5 ? '#ff9d2e' : '#ffd23f',
        2 + Math.random() * 3, 0.25 + Math.random() * 0.2, 3.5, 'rect');
    },

    /* Mining / impact sparks.
     * b1-wire-fx: color-matched spark sprite replaces the 6-particle
     * burst when ready; otherwise the exact old burst. */
    sparks: function (x, y, color) {
      preloadFxSprites();
      var id = sparkIdFor(color);
      if (spriteReady('fx/sparks', id)) {
        stamp(x, y, id, 'spark', 30, 0.32, 'fx/sparks');
        return;
      }
      this.burst(x, y, color || '#ffd23f', qn(6), 220, 0.4, 2.5);
    },

    /* Muzzle flash at the weapon mount.
     * b1-wire-fx: weapon-kind-matched muzzle sprite replaces the
     * 3-particle burst when ready; otherwise the exact old burst.
     * kind is optional (old callers pass color only -> bolt fallback). */
    /* twelve-hour-wave2: size lets heavy weapons flash bigger than peashooters
     * (ship.js passes a per-kind size; default 38 preserves the old flash). */
    muzzle: function (x, y, color, kind, size) {
      preloadFxSprites();
      var id = muzzleIdFor(kind);
      if (spriteReady('fx/muzzle', id)) {
        stamp(x, y, id, 'muzzle', size || 38, 0.16, 'fx/muzzle');
        return;
      }
      this.burst(x, y, color, qn(3), 90, 0.18, 2.5);
    },

    /* Shield-hit ring flash. b1-wire-fx: a shield-variant ring sprite
     * (cyan on a hit, magenta when the hit breaks the shield, teal on
     * explicit request) replaces the 6-particle shield burst when
     * ready; otherwise the exact old burst. size = ring diameter px. */
    shieldHit: function (x, y, broken, size, variant) {
      preloadFxSprites();
      var id = (variant && SHIELD_IDS.indexOf(variant) >= 0) ? variant
        : (broken ? 'ring-magenta' : 'ring-cyan');
      if (spriteReady('fx/shield', id)) {
        stamp(x, y, id, 'shield', size || 64, 0.45, 'fx/shield');
        return;
      }
      this.burst(x, y, '#3fa9ff', 6, 160, 0.35, 3);
    },

    /* graphics-juice: how many particles are currently alive (smoke-test hook). */
    activeCount: function () {
      var n = 0;
      for (var i = 0; i < pool.length; i++) if (pool[i].active) n++;
      return n;
    },

    update: function (dt) {
      // twelve-hour-wave2: fire staged debris bursts whose delay elapsed
      for (var qi = debrisQueue.length - 1; qi >= 0; qi--) {
        var dq = debrisQueue[qi];
        dq.t -= dt;
        if (dq.t <= 0) {
          debrisQueue.splice(qi, 1);
          this.burst(dq.x, dq.y, '#ff8c2e', qn(4 * dq.scale), 120 * dq.scale, 0.5, 4 * dq.scale);
          this.burst(dq.x, dq.y, '#3a3a4a', qn(3 * dq.scale), 70 * dq.scale, 0.9, 5 * dq.scale);
        }
      }
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        var d = 1 - Math.min(1, p.drag * dt);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      // v2-fx-wiring: age the explosion sprite overlays
      for (var j = 0; j < expPool.length; j++) {
        var o = expPool[j];
        if (!o.active) continue;
        o.life -= dt;
        if (o.life <= 0) o.active = false;
      }
    },

    draw: function (ctx) {
      /* b-perf: view-cull overlay stamps and particle bucket pushes.
       * Overlays are at most 24 live stamps; particles are batched, so
       * culling their pushes saves CPU (fewer path segments) rather
       * than canvas calls, but an offscreen particle was clipped
       * anyway — no visible change on any tier. */
      var ptView = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var ptVis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      /* v2-fx-wiring: explosion sprite overlays first (the additive
       * particle pass layers on top of them). Loader-null skips a stamp. */
      for (var oi = 0; oi < expPool.length; oi++) {
        var o = expPool[oi];
        if (!o.active) continue;
        var img = (window.SF && SF.Sprites) ? SF.Sprites.get(o.dir || 'fx/explosions', o.id) : null;
        if (!img) continue;
        var t = o.life / o.maxLife; // 1 at birth -> 0 at death
        var grow, alpha;
        ctx.save();
        if (o.layer === 'main') {
          grow = 1.15 - 0.45 * t; alpha = Math.min(1, t * 1.6);
          ctx.globalCompositeOperation = 'lighter';
        } else if (o.layer === 'wave') {
          grow = 0.35 + (1 - t) * 1.15; alpha = 0.75 * t;
          ctx.globalCompositeOperation = 'lighter';
        } else if (o.layer === 'muzzle') {
          // b1-wire-fx: brief additive flash, slight shrink + fast fade
          grow = 0.85 + 0.3 * t; alpha = Math.min(1, t * 1.4);
          ctx.globalCompositeOperation = 'lighter';
        } else if (o.layer === 'trail') {
          // b1-wire-fx: soft normal-blend puff swell + fade
          grow = 0.7 + (1 - t) * 0.7; alpha = 0.42 * t;
        } else if (o.layer === 'spark') {
          // b1-wire-fx: additive spark burst, slight swell + fast fade
          grow = 0.9 + (1 - t) * 0.4; alpha = Math.min(1, t * 1.6);
          ctx.globalCompositeOperation = 'lighter';
        } else if (o.layer === 'shield') {
          // b1-wire-fx: additive ring swell + fade on shield hits
          grow = 0.85 + (1 - t) * 0.4; alpha = 0.95 * t;
          ctx.globalCompositeOperation = 'lighter';
        } else { // smoke: normal blending, slow swell, long fade
          grow = 0.8 + (1 - t) * 0.5; alpha = 0.38 * t;
        }
        var sz = o.size * grow;
        if (ptVis && !ptVis(ptView, o.x, o.y, sz / 2 + 2)) { ctx.restore(); continue; }
        ctx.globalAlpha = alpha;
        ctx.translate(o.x, o.y);
        if (o.layer === 'main' || o.layer === 'wave' ||
            o.layer === 'muzzle' || o.layer === 'spark') ctx.rotate(o.rot);
        ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        var t = p.life / p.maxLife;
        if (ptVis && !ptVis(ptView, p.x, p.y,
            p.kind === 'ring' ? p.size * 2.5 + 2 : p.size + 2)) continue;
        if (p.kind === 'ring') {
          // expanding shockwave ring
          pushArc(sbucket(qkey(p.color, t)), p.x, p.y, p.size * (0.3 + (1 - t) * 2.2));
          continue;
        }
        var s = p.size * (0.5 + t * 0.5);
        pushRect(fbucket(qkey(p.color, t)), p.x, p.y, s);
      }
      flushFill(ctx);
      flushStroke(ctx);
      ctx.restore();
      ctx.globalAlpha = 1;
    },

    /* v2-fx-wiring: explosion sprite hooks (smoke tests). */
    explosionSpriteFor: function (scale, ion) { return explosionIdFor(scale || 1, ion); },
    activeSprites: function () {
      var n = 0;
      for (var i = 0; i < expPool.length; i++) if (expPool[i].active) n++;
      return n;
    },
    explosionSpriteIds: EXP_IDS,
    /* b1-wire-fx: wired-FX hooks (smoke tests). */
    muzzleSpriteFor: function (kind) { return 'fx/muzzle/' + muzzleIdFor(kind); },
    sparkSpriteFor: function (color) { return 'fx/sparks/' + sparkIdFor(color); },
    shieldSpriteFor: function (broken) { return 'fx/shield/' + (broken ? 'ring-magenta' : 'ring-cyan'); },
    fxSpriteIds: { muzzle: MUZZLE_IDS, trail: TRAIL_IDS, sparks: SPARK_IDS, shield: SHIELD_IDS },
    activeFxSprites: function () {
      var n = 0;
      for (var i = 0; i < expPool.length; i++) {
        var l = expPool[i].layer;
        if (expPool[i].active && (l === 'muzzle' || l === 'trail' || l === 'spark' || l === 'shield')) n++;
      }
      return n;
    },
    trailActive: function () {
      return trailSlot >= 0 && !!expPool[trailSlot].active && expPool[trailSlot].layer === 'trail';
    }
  };
})();

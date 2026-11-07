/* STARFALL Phase 1 — projectiles.js
 * Fixed-size object pool. No allocation in the hot loop.
 * weapons-arsenal phase: kind-aware projectile visuals, blast AoE via
 * detonate(), mine arming (0.8s) — proximity fuse handled in main.js.
 * balance-perf phase: cursor spawn (amortized O(1), survives external
 * pr.active=false writes), allocation-free batched draw (one fill/stroke
 * per color+alpha bucket instead of save/translate/restore per shot),
 * activeCount() smoke hook.
 */
window.SF = window.SF || {};

SF.Projectiles = (function () {
  var POOL = 256;
  var pool = [];
  var cursor = 0; // spawn scan cursor: resumes where the last spawn landed

  function make() {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, life: 0, maxLife: 1,
             radius: 3, friendly: true, color: '#fff', homing: false, turn: 0, target: null,
             kind: 'bolt', mine: false, armed: false, armT: 0, blast: 0, emp: 0, crit: false };
  }

  /* ---- allocation-free draw buckets ----
   * key = color + '|' + alphaBucket(0..7). Each bucket owns preallocated
   * flat arrays: quads (8 floats = 4 corners) and arcs (3 floats = x,y,r).
   * One beginPath + one fill/stroke per bucket per frame. */
  var QN = 256, AN = 256;
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
  function pushQuad(b, x1, y1, x2, y2, x3, y3, x4, y4) {
    if (b.nq >= QN) return;
    var o = b.nq * 8, q = b.q;
    q[o] = x1; q[o+1] = y1; q[o+2] = x2; q[o+3] = y2;
    q[o+4] = x3; q[o+5] = y3; q[o+6] = x4; q[o+7] = y4;
    b.nq++;
  }
  function pushArc(b, x, y, r) {
    if (b.na >= AN) return;
    var o = b.na * 3, a = b.a;
    a[o] = x; a[o+1] = y; a[o+2] = r;
    b.na++;
  }
  /* rotated rect centered at (x,y), half-extents (hx,hy), angle a -> quad */
  function rquad(b, x, y, hx, hy, c, s) {
    var ux = c * hx, uy = s * hx, vx = -s * hy, vy = c * hy;
    pushQuad(b, x - ux - vx, y - uy - vy, x + ux - vx, y + uy - vy,
                x + ux + vx, y + uy + vy, x - ux + vx, y - uy + vy);
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
        ctx.moveTo(q[o], q[o+1]); ctx.lineTo(q[o+2], q[o+3]);
        ctx.lineTo(q[o+4], q[o+5]); ctx.lineTo(q[o+6], q[o+7]);
        ctx.closePath();
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
  function flushStroke(ctx, lineWidth) {
    for (var i = 0; i < strokeUsed.length; i++) {
      var key = strokeUsed[i], b = strokeBk[key];
      var sep = key.lastIndexOf('|');
      ctx.globalAlpha = (+key.slice(sep + 1)) / 7;
      ctx.strokeStyle = key.slice(0, sep);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      var q = b.q;
      for (var k = 0; k < b.nq; k++) {
        var o = k * 8;
        ctx.moveTo(q[o], q[o+1]); ctx.lineTo(q[o+2], q[o+3]);
        ctx.lineTo(q[o+4], q[o+5]); ctx.lineTo(q[o+6], q[o+7]);
        ctx.closePath();
      }
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

  /* ---- v2-fx-wiring: file-backed projectile sprites ----
   * Sprite-first per projectile kind via SF.Sprites (kind may contain a
   * slash: 'fx/projectiles', 'fx/mines-drones'). A null from the loader
   * (still loading / missing file) keeps the batched procedural draw
   * below, so a missing sprite never blanks a shot.
   * Orientation: missile/laser/torpedo art is authored nose-up and
   * rotates +PI/2 into the nose-+X travel frame (the SF.Ship.drawSpriteHull
   * convention). The plasma/charge orbs are authored with the orb at the
   * bottom and their discharge trailing up, so the orb leads at -PI/2.
   * Kind mapping (weapon classes from SF.CONFIG.weapons):
   *   bolt/beam -> laser, pellet -> charge, orb -> charge (green plasma),
   *   emp -> plasma (violet ion orb), missile -> missile (seekers),
   *   missile+blast -> rocket (heavy torpedoes), slug -> torpedo (dart),
   *   starfall -> plasma body + its golden tri-spark stays on top,
   *   mine -> proximity-mine / emp-mine (fx/mines-drones).
   */
  var FX_PROJECTILE_IDS = ['laser', 'plasma', 'charge', 'missile', 'rocket', 'torpedo'];
  var FX_MINE_IDS = ['proximity-mine', 'emp-mine'];
  var fxSpritesPreloaded = false;

  function preloadFxSprites() {
    if (fxSpritesPreloaded) return;
    fxSpritesPreloaded = true;
    if (window.SF && SF.Sprites) {
      SF.Sprites.preload('fx/projectiles', FX_PROJECTILE_IDS);
      SF.Sprites.preload('fx/mines-drones', FX_MINE_IDS);
    }
  }

  function projectileSpriteFor(p) {
    if (!p) return null;
    if (p.mine || p.kind === 'mine') {
      return { kind: 'fx/mines-drones', id: p.emp > 0 ? 'emp-mine' : 'proximity-mine',
               size: 30, rot: 0, spin: true };
    }
    switch (p.kind) {
      case 'missile':
        return p.blast > 0
          ? { kind: 'fx/projectiles', id: 'rocket', size: 38, rot: Math.PI / 2 }
          : { kind: 'fx/projectiles', id: 'missile', size: 34, rot: Math.PI / 2 };
      case 'slug':
        return { kind: 'fx/projectiles', id: 'torpedo', size: 30, rot: Math.PI / 2 };
      case 'orb':
        return { kind: 'fx/projectiles', id: 'charge', size: 27, rot: -Math.PI / 2 };
      case 'emp':
        return { kind: 'fx/projectiles', id: 'plasma', size: 30, rot: -Math.PI / 2 };
      case 'starfall':
        return { kind: 'fx/projectiles', id: 'plasma', size: 30, rot: -Math.PI / 2 };
      case 'beam':
        return { kind: 'fx/projectiles', id: 'laser', size: 30, rot: Math.PI / 2 };
      case 'pellet':
        return { kind: 'fx/projectiles', id: 'charge', size: 15, rot: -Math.PI / 2 };
      default: // bolt + anything unrecognised
        return { kind: 'fx/projectiles', id: 'laser', size: 24, rot: Math.PI / 2 };
    }
  }

  /* Blast AoE: hurts enemies+asteroids (friendly) or the player (enemy shots). */
  function detonate(p, worldSize) {
    var R = p.blast || 90;
    var dmg = p.dmg;
    // graphics-juice: layered explosion + shake on detonation
    // v2-fx-wiring: EMP-flavoured blasts (Event Horizon) stamp the ion sprite
    SF.Particles.explosion(p.x, p.y, Math.max(0.8, R / 90), p.emp > 0);
    if (window.SF && SF.FX) SF.FX.shake(7);
    SF.Audio.explosion(true);
    if (p.friendly) {
      var el = SF.Enemies.list;
      for (var i = el.length - 1; i >= 0; i--) {
        var e = el[i];
        var dx = p.x - e.x, dy = p.y - e.y;
        var rr = R + e.radius;
        if (dx * dx + dy * dy < rr * rr) SF.Enemies.damage(e, dmg * 0.6);
      }
      var al = SF.Asteroids.list;
      for (var j = 0; j < al.length; j++) {
        var a = al[j];
        if (a.dead) continue;
        var ax = p.x - a.x, ay = p.y - a.y;
        var ar = R + a.r;
        if (ax * ax + ay * ay < ar * ar) SF.Asteroids.damage(a, dmg * 0.6);
      }
    } else if (SF.Player.alive) {
      var px = p.x - SF.Player.x, py = p.y - SF.Player.y;
      var prad = R + SF.Player.radius;
      if (px * px + py * py < prad * prad) SF.Player.takeDamage(dmg * 0.6);
    }
  }

  return {
    pool: pool,

    init: function () {
      pool.length = 0;
      for (var i = 0; i < POOL; i++) pool.push(make());
      cursor = 0;
    },

    clear: function () {
      for (var i = 0; i < pool.length; i++) pool[i].active = false;
      cursor = 0;
    },

    /* balance-perf: how many projectiles are currently alive (smoke-test hook). */
    activeCount: function () {
      var n = 0;
      for (var i = 0; i < pool.length; i++) if (pool[i].active) n++;
      return n;
    },

    detonate: function (p) { detonate(p, SF.CONFIG.worldSize); },

    spawn: function (x, y, angle, speed, dmg, friendly, color, opts) {
      preloadFxSprites(); // v2-fx-wiring: warm the sprite cache before first draw
      opts = opts || {};
      // cursor scan: amortized O(1); wraps once before giving up (pool full).
      // (branch wrap, not modulo — modulo dominated the hot loop in profiling)
      var n = pool.length, i = cursor, p;
      for (var k = 0; k < n; k++) {
        p = pool[i];
        if (++i >= n) i = 0;
        if (p.active) continue;
        cursor = i;
        p.active = true;
        p.x = x; p.y = y;
        p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
        p.dmg = dmg; p.friendly = friendly; p.color = color;
        p.radius = opts.radius || 3;
        p.homing = !!opts.homing; p.turn = opts.turn || 0; p.target = opts.target || null;
        p.maxLife = opts.life || 1.6; p.life = p.maxLife;
        p.kind = opts.kind || 'bolt';
        p.mine = !!opts.mine; p.armed = false; p.armT = 0;
        p.blast = opts.blast || 0; p.emp = opts.emp || 0;
        p.crit = !!opts.crit; // twelve-hour-wave2: crit flag rides the bolt to enemies.damage()
        return p;
      }
      cursor = i;
      return null; // pool exhausted: drop the shot
    },

    update: function (dt, worldSize) {
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          // torpedoes/hellbore burst on expiry; mines just fade
          if (p.blast > 0 && !p.mine) detonate(p, worldSize);
          p.active = false; continue;
        }
        if (p.mine) {
          p.armT += dt;
          if (!p.armed && p.armT >= 0.8) p.armed = true;
          // mines drift and stop
          var damp = Math.max(0, 1 - 2.2 * dt);
          p.vx *= damp; p.vy *= damp;
          p.x += p.vx * dt; p.y += p.vy * dt;
          continue;
        }
        if (p.homing && p.target && p.target.hp > 0) {
          var want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          var cur = Math.atan2(p.vy, p.vx);
          var d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          var sp = Math.hypot(p.vx, p.vy);
          var na = cur + Math.max(-p.turn * dt, Math.min(p.turn * dt, d));
          p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        // open-space-1: no world box — a bolt dies when it has flown
        // far from the player (life expiry still applies first).
        var pl = (typeof SF !== 'undefined' && SF.Player) ? SF.Player : null;
        if (pl) {
          var pdx = p.x - pl.x, pdy = p.y - pl.y;
          if (pdx * pdx + pdy * pdy > 6000 * 6000) p.active = false;
        }
      }
    },

    draw: function (ctx) {
      preloadFxSprites();
      /* b-perf: (1) view-cull every bolt whose extent rect is off-canvas
       * (canvas-clipped anyway — no visible change, saves the drawImage
       * or the bucket pushes); (2) on the s25 tier, skip the per-bolt
       * sprite drawImage entirely and run the batched procedural path
       * below instead (one fill per color+alpha bucket for ALL bolts,
       * the same fallback art used while sprites load). The 256-slot
       * pool, speeds, damage and lifetimes are untouched — only the
       * paint path changes, and only on s25; High keeps sprites. */
      var view = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var vis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      var s25 = !!(window.SF && SF.FX && SF.FX.getEffective &&
                   SF.FX.getEffective() === 's25');
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        var a = Math.atan2(p.vy, p.vx);
        var baseA = Math.min(1, p.life / (p.maxLife * 0.4) + 0.25);
        var c = Math.cos(a), s = Math.sin(a);
        /* v2-fx-wiring: sprite first. drewSprite suppresses the procedural
         * branch below except for 'starfall' (its golden tri-spark stays
         * layered over the plasma body). Mines additionally queue their
         * armed outline ring into the stroke buckets over the sprite. */
        var drewSprite = false;
        var sprDef = (window.SF && SF.Sprites) ? projectileSpriteFor(p) : null;
        var sprImg = sprDef ? SF.Sprites.get(sprDef.kind, sprDef.id) : null;
        if (vis && !vis(view, p.x, p.y, sprDef ? sprDef.size / 2 + 4 : 16)) continue;
        if (!s25 && sprImg) {
          drewSprite = true;
          ctx.save();
          if (p.kind === 'mine' || p.mine) {
            ctx.globalAlpha = p.armed ? 1 : 0.55 + 0.35 * Math.sin(p.armT * 14);
          } else {
            ctx.globalAlpha = baseA;
          }
          ctx.translate(p.x, p.y);
          if (sprDef.spin) ctx.rotate(p.armT * 0.6); // mines idle-spin in place
          else if (sprDef.rot) ctx.rotate(a + sprDef.rot);
          ctx.drawImage(sprImg, -sprDef.size / 2, -sprDef.size / 2, sprDef.size, sprDef.size);
          ctx.restore();
          if ((p.kind === 'mine' || p.mine) && p.armed) {
            pushArc(sbucket(qkey('#ffffff', 0.9)), p.x, p.y,
              sprDef.size / 2 + 3 + 1.5 * Math.sin(p.armT * 14));
          }
        }
        if (drewSprite && p.kind !== 'starfall') {
          continue; // sprite drawn (mines included): no procedural body
        }
        if (p.kind === 'slug') {
          // long streak
          var b = fbucket(qkey(p.color, Math.min(1, baseA + 0.3)));
          rquad(b, p.x, p.y, 13, 1.5, c, s);
        } else if (p.kind === 'orb') {
          // glowing plasma orb: halo + core + white dot
          pushArc(fbucket(qkey(p.color, baseA * 0.35)), p.x, p.y, p.radius + 5);
          pushArc(fbucket(qkey(p.color, baseA)), p.x, p.y, p.radius + 1);
          pushArc(fbucket(qkey('#ffffff', baseA)), p.x, p.y, 1.5);
        } else if (p.kind === 'pellet') {
          pushArc(fbucket(qkey(p.color, baseA)), p.x, p.y, p.radius);
        } else if (p.kind === 'missile') {
          // dart polygon: nose (8,0), tail (-5,±4), notch (-3,0)
          var m = fbucket(qkey(p.color, baseA));
          var nx = c * 8, ny = s * 8;
          var tx = -c * 5, ty = -s * 5;
          var px = -s * 4, py = c * 4;
          var qx = -c * 3, qy = -s * 3;
          pushQuad(m, p.x + nx, p.y + ny, p.x + tx + px, p.y + ty + py,
                      p.x + qx, p.y + qy, p.x + tx - px, p.y + ty - py);
        } else if (p.kind === 'mine') {
          // pulsing diamond; blinks until armed
          var pulse = 0.6 + 0.4 * Math.sin(p.armT * 14);
          var ma = p.armed ? 1 : pulse * 0.7;
          var ms = p.armed ? 7 : 5;
          var hs = ms / 2;
          var mc = p.armed ? p.color : '#666666';
          pushQuad(fbucket(qkey(mc, ma)), p.x, p.y - hs, p.x + hs, p.y, p.x, p.y + hs, p.x - hs, p.y);
          if (p.armed) {
            var os = hs + 3;
            pushQuad(sbucket(qkey('#ffffff', 1)), p.x, p.y - os, p.x + os, p.y, p.x, p.y + os, p.x - os, p.y);
          }
        } else if (p.kind === 'beam') {
          // thin lash: bright core + soft halo
          var bb = fbucket(qkey(p.color, baseA));
          rquad(bb, p.x, p.y, 14, 1, c, s);
          var bh = fbucket(qkey(p.color, baseA * 0.4));
          rquad(bh, p.x, p.y, 14, 3.5, c, s);
        } else if (p.kind === 'emp') {
          // crackling ion burst: ring + white core
          var r2 = p.radius + 3 + Math.random() * 3;
          pushArc(sbucket(qkey(p.color, baseA)), p.x, p.y, r2);
          pushArc(fbucket(qkey('#ffffff', baseA)), p.x, p.y, 2);
        } else if (p.kind === 'starfall') {
          // golden tri-spark with halo
          pushArc(fbucket(qkey(p.color, baseA * 0.4)), p.x, p.y, p.radius + 6);
          var sb = fbucket(qkey(p.color, baseA));
          rquad(sb, p.x, p.y, 8, 2.5, c, s);
          var sw = fbucket(qkey('#ffffff', baseA));
          rquad(sw, p.x, p.y, 3, 1, c, s);
        } else {
          // bolt (default)
          var blen = p.friendly ? 10 : 8;
          var bz = fbucket(qkey(p.color, baseA));
          rquad(bz, p.x, p.y, blen / 2, p.radius / 2, c, s);
        }
      }
      flushFill(ctx);
      flushStroke(ctx, 2);   // emp rings use lineWidth 2 (matches legacy)
      // mine armed outlines need lineWidth 1.5: they are rare; repaint thin.
      // (folded into the stroke flush would need per-bucket widths; instead
      // draw armed outlines with their own pass when any exist)
      ctx.globalAlpha = 1;
    },

    /* v2-fx-wiring: sprite mapping hook (smoke tests).
     * Returns 'kind/id' for a projectile-like object, e.g.
     * projectileSpriteFor({kind:'missile', blast:130}) -> 'fx/projectiles/rocket'. */
    projectileSpriteFor: function (p) {
      var d = projectileSpriteFor(p);
      return d ? d.kind + '/' + d.id : null;
    },
    fxSpriteIds: { projectiles: FX_PROJECTILE_IDS, mines: FX_MINE_IDS }
  };
})();

/* NOTE: mine armed outlines were merged into the stroke flush at lineWidth 2
 * (legacy drew 1.5). Visual difference is sub-pixel at these sizes; kept the
 * single-width flush to preserve the one-stroke-per-bucket guarantee. */

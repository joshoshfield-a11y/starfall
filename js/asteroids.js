/* STARFALL Phase 1 — asteroids.js
 * Mineable rocks. Shooting (or ramming, weakly) breaks them into ore chunks.
 *
 * v2-celestial-wiring: rocks carry a composition type drawn from the optimized
 * sprite set (assets/sprites/celestial/asteroids/<comp>.png); the asteroid
 * field renders a per-system backdrop sprite (celestial/fields/<id>.png).
 * Procedural polygon drawing stays as the fallback. Runtime-only: comp is
 * assigned at scatter time and never serialized — save-neutral (stays v11).
 */
window.SF = window.SF || {};

SF.Asteroids = (function () {
  var list = [];

  /* v2-celestial-wiring: composition types with rarity weights (sum = 100). */
  var COMPOSITIONS = [
    ['silicate', 20], ['carbonaceous', 18], ['fragmented', 16],
    ['metallic', 12], ['ice-rich', 10], ['composite', 8],
    ['sponge', 6], ['crystal', 4], ['volcanic', 3], ['radioactive', 3]
  ];
  function pickComp() {
    var r = Math.random() * 100, acc = 0;
    for (var i = 0; i < COMPOSITIONS.length; i++) {
      acc += COMPOSITIONS[i][1];
      if (r < acc) return COMPOSITIONS[i][0];
    }
    return 'silicate';
  }

  /* v2-celestial-wiring: field backdrop sprite per system, drawn under the rocks. */
  var FIELD_BY_SYSTEM = { solace: 'belt', drift: 'scattered', ember: 'collision' };
  var fieldId = null, fieldCx = 0, fieldCy = 0, fieldSize = 1200;
  var _v2Preloaded = false;
  function preloadV2() {
    if (_v2Preloaded || !(window.SF && SF.Sprites)) return;
    _v2Preloaded = true;
    SF.Sprites.preload('celestial/asteroids',
      COMPOSITIONS.map(function (c) { return c[0]; }));
    if (fieldId) SF.Sprites.preload('celestial/fields', [fieldId, fieldId + '-512']);
  }

  function makeRock(x, y, r) {
    var cfg = SF.CONFIG.asteroid;
    var verts = [];
    var n = 8 + Math.floor(Math.random() * 4);
    for (var i = 0; i < n; i++) {
      verts.push(0.72 + Math.random() * 0.38);
    }
    return {
      x: x, y: y, r: r, hp: cfg.hp, maxHp: cfg.hp,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
      verts: verts, comp: pickComp(), dead: false
    };
  }

  function scatter(list, n, worldSize, avoid) {
    var tries = 0;
    while (list.length < n && tries < n * 40) {
      tries++;
      var x = 200 + Math.random() * (worldSize - 400);
      var y = 200 + Math.random() * (worldSize - 400);
      var ok = true;
      if (avoid) {
        for (var i = 0; i < avoid.length; i++) {
          var dx = x - avoid[i].x, dy = y - avoid[i].y;
          if (dx * dx + dy * dy < 500 * 500) { ok = false; break; }
        }
      }
      if (!ok) continue;
      var r = SF.CONFIG.asteroid.radiusMin +
              Math.random() * (SF.CONFIG.asteroid.radiusMax - SF.CONFIG.asteroid.radiusMin);
      list.push(makeRock(x, y, r));
    }
  }

  return {
    list: list,

    init: function (systemId, keepClear) {
      list.length = 0;
      var sys = SF.SYSTEM_BY_ID[systemId];
      scatter(list, sys.asteroids, SF.CONFIG.worldSize, keepClear || []);
      // v2-celestial-wiring: field backdrop centers on the rock scatter
      fieldId = FIELD_BY_SYSTEM[systemId] || 'scattered';
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
        if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y;
      }
      if (list.length) {
        fieldCx = (x0 + x1) / 2; fieldCy = (y0 + y1) / 2;
        fieldSize = Math.max(900, Math.max(x1 - x0, y1 - y0) * 1.15);
      } else {
        fieldCx = SF.CONFIG.worldSize / 2; fieldCy = SF.CONFIG.worldSize / 2;
        fieldSize = 1200;
      }
      if (window.SF && SF.Sprites) SF.Sprites.preload('celestial/fields', [fieldId, fieldId + '-512']);
    },

    /* open-space-1: no wall bounce. Rocks drift freely; any rock
     * (live or mined-dead) that ends up farther than RECYCLE_R from the
     * player is recycled to fresh scatter near the player, so fields
     * stay dense around the player forever without growing the list.
     * In-region the fresh spot is inside the region cell; in deep space
     * it is an annulus around the player (procedural scatter). The
     * second arg is the player (main.js); a legacy numeric worldSize
     * still works via the SF.Player fallback. */
    update: function (dt, player) {
      var p = (player && typeof player.x === 'number') ? player : SF.Player;
      var RECYCLE_R = 3200;
      var ws = SF.CONFIG.worldSize;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        a.rot += a.rotSpeed * dt;
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (!p) continue;
        var dx = a.x - p.x, dy = a.y - p.y;
        if (dx * dx + dy * dy > RECYCLE_R * RECYCLE_R) {
          var deep = false;
          try { deep = window.SF && SF.Space && SF.Space.deepSpace(); } catch (e) {}
          if (deep) {
            var ang = Math.random() * Math.PI * 2;
            var rr = 1000 + Math.random() * 800;
            a.x = p.x + Math.cos(ang) * rr; a.y = p.y + Math.sin(ang) * rr;
          } else {
            a.x = 200 + Math.random() * (ws - 400);
            a.y = 200 + Math.random() * (ws - 400);
          }
          a.dead = false; a.hp = a.maxHp; a.comp = pickComp();
          a.vx = (Math.random() - 0.5) * 12; a.vy = (Math.random() - 0.5) * 12;
        }
      }
    },

    damage: function (a, dmg) {
      if (a.dead) return;
      a.hp -= dmg;
      SF.Particles.burst(a.x, a.y, '#9a9ab0', 5, 140, 0.35, 3);
      SF.Particles.sparks(a.x, a.y, '#ffd23f'); // graphics-juice: mining sparks
      if (a.hp <= 0) {
        a.dead = true;
        var cfg = SF.CONFIG.asteroid;
        var n = cfg.oreMin + Math.floor(Math.random() * (cfg.oreMax - cfg.oreMin + 1));
        for (var i = 0; i < n; i++) SF.Pickups.spawnOre(a.x, a.y, 1);
        // graphics-juice: rock shatters with an explosion + small shake
        SF.Particles.explosion(a.x, a.y, Math.max(0.7, a.r / 28));
        if (window.SF && SF.FX) SF.FX.shake(3);
        SF.Audio.explosion(false);
      }
    },

    draw: function (ctx) {
      preloadV2();
      // v2-celestial-wiring: field backdrop sprite behind the rocks.
      // bg-blur fix (2026-10-20, from the user's S25 screenshot): the old
      // draw stretched the 256px field art over the whole rock scatter
      // (~4000+ world units - a ~19x upscale) and read as a full-screen
      // brown smear on device. Now the -512 art is mirror-tiled at native
      // texel scale (1 world unit per texel) across the field rect,
      // culled to the visible world rect from the canvas transform.
      if (fieldId && window.SF && SF.Sprites) {
        var fimg = SF.Sprites.get('celestial/fields', fieldId + '-512') ||
                   SF.Sprites.get('celestial/fields', fieldId);
        if (fimg) {
          var TILE = 512;
          var fx0 = fieldCx - fieldSize / 2, fy0 = fieldCy - fieldSize / 2;
          var vx0 = fx0, vy0 = fy0, vx1 = fx0 + fieldSize, vy1 = fy0 + fieldSize;
          try {
            var inv = ctx.getTransform().inverse();
            var cw = ctx.canvas.width, chh = ctx.canvas.height;
            var pts = [
              inv.transformPoint(new DOMPoint(0, 0)),
              inv.transformPoint(new DOMPoint(cw, 0)),
              inv.transformPoint(new DOMPoint(0, chh)),
              inv.transformPoint(new DOMPoint(cw, chh))
            ];
            vx0 = Math.min(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
            vx1 = Math.max(pts[0].x, pts[1].x, pts[2].x, pts[3].x);
            vy0 = Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
            vy1 = Math.max(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
          } catch (e) {}
          var nT = Math.ceil(fieldSize / TILE);
          var ix0 = Math.max(0, Math.floor((vx0 - fx0) / TILE));
          var iy0 = Math.max(0, Math.floor((vy0 - fy0) / TILE));
          var ix1 = Math.min(nT - 1, Math.floor((vx1 - fx0) / TILE));
          var iy1 = Math.min(nT - 1, Math.floor((vy1 - fy0) / TILE));
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.rect(fx0, fy0, fieldSize, fieldSize);
          ctx.clip();
          for (var tj = iy0; tj <= iy1; tj++) {
            for (var ti = ix0; ti <= ix1; ti++) {
              var tx = fx0 + ti * TILE, ty = fy0 + tj * TILE;
              var mx = (ti % 2) === 1, my = (tj % 2) === 1;
              ctx.save();
              ctx.translate(tx + (mx ? TILE : 0), ty + (my ? TILE : 0));
              ctx.scale(mx ? -1 : 1, my ? -1 : 1);
              ctx.drawImage(fimg, 0, 0, TILE, TILE);
              ctx.restore();
            }
          }
          ctx.restore();
        }
      }
      /* b-perf: view-cull rocks (field tiles above are already culled
       * by transform). Rocks are scattered over the whole 4200-unit
       * system, so most are offscreen at any moment; a skipped rock
       * was canvas-clipped anyway. Damage cracks live inside the same
       * extent, so culling the whole rock is safe. */
      var aView = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var aVis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.dead) continue;
        if (aVis && !aVis(aView, a.x, a.y, a.r * 1.3 + 4)) continue;
        // v2-celestial-wiring: sprite by composition type, procedural fallback
        var spr = (window.SF && SF.Sprites) ?
          SF.Sprites.get('celestial/asteroids', a.comp || 'silicate') : null;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.rot);
        if (spr) {
          var d = a.r * 2.6;
          ctx.drawImage(spr, -d / 2, -d / 2, d, d);
        } else {
          // original procedural polygon fallback
          ctx.fillStyle = '#4a4a5c';
          ctx.strokeStyle = '#6e6e86';
          ctx.lineWidth = 2;
          ctx.beginPath();
          var n = a.verts.length;
          for (var j = 0; j < n; j++) {
            var ang = (j / n) * Math.PI * 2;
            var rr = a.r * a.verts[j];
            if (j === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
            else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        // damage cracks (read over sprite or polygon alike)
        if (a.hp < a.maxHp * 0.5) {
          ctx.strokeStyle = '#2c2c38';
          ctx.beginPath();
          ctx.moveTo(-a.r * 0.4, -a.r * 0.2); ctx.lineTo(0, a.r * 0.1); ctx.lineTo(a.r * 0.4, -a.r * 0.3);
          ctx.stroke();
        }
        ctx.restore();
      }
    },

    /* v2-celestial-wiring: test hooks. */
    compositions: function () { return COMPOSITIONS.map(function (c) { return c[0]; }); },
    fieldForSystem: function (sid) { return FIELD_BY_SYSTEM[sid] || 'scattered'; },
    currentField: function () { return fieldId; }
  };
})();

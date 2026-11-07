/* STARFALL open-space-1 — SF.Space: seamless regions on one galaxy frame.
 *
 * OLD MODEL: every system was a 4200x4200 square and every actor was
 * clamped/bounced inside it. The square was a wall.
 *
 * NEW MODEL: coordinates are REGION-LOCAL, exactly as before — every
 * station, planet, derelict, waypoint and save field keeps working
 * unchanged — but regions sit on a shared galaxy plane, and the square is
 * only a content anchor, never a wall:
 *
 *   absolute position = local position + REGION_ORIGIN[systemId]
 *
 * Region origins are derived from the starmap node positions (starmap.js
 * POS + starmap-hazards POS, in percent): origin = POS * 168. The 168
 * scale (= 4.2 * 40) spaces the 4200-unit cells so no two cells overlap:
 *   solace (3696, 9240)-(7896, 13440)   drift (8736, 5040)-(12936, 9240)
 *   ember  (13104, 10416)-(17304, 14616)
 * Between cells lies deep space: unbounded, with procedural scatter.
 *
 * CROSSING (no remap needed — the galaxy frame is continuous): each frame
 * main.js asks checkCrossing(). If the player's absolute position falls
 * inside a DIFFERENT region's cell, crossTo() shifts every live entity by
 * (oldOrigin - newOrigin) so every local coordinate lands in the new
 * frame, swaps systemId/theme/content, toasts, and saves. Heading and
 * velocity are untouched; the camera shift is applied by main.js so the
 * view does not move. Flying in a direction with no neighboring cell
 * simply stays in deep space — no wall, no stranding (fly back, or use
 * the starmap jump, which is untouched).
 *
 * DEEP SPACE: SF.Game.systemId stays the LAST region visited, so every
 * systemId-scoped system (encounters, difficulty, secrets, FX theme,
 * music) keeps working. deepSpace() reports whether the player is
 * outside all cells; the HUD shows "Deep Space" instead of the region
 * name in that case.
 *
 * SAVE: unchanged, stays v12. The save stores systemId + local x/y, which
 * is exactly the frame the player is in after any crossing. Old saves
 * load identically (their local coords were always region-local).
 *
 * PERFORMANCE: membership is an O(#systems) cell test per frame; entity
 * counts stay bounded via the far-cull in enemies.js and rock recycling
 * in asteroids.js. Nothing scans the world.
 */
window.SF = window.SF || {};

SF.Space = (function () {
  'use strict';
  var SF = window.SF;

  /* Mirror of the starmap node positions (percent) x 168. */
  var ORIGIN = {
    solace: { x: 22 * 168, y: 55 * 168 },
    drift:  { x: 52 * 168, y: 30 * 168 },
    ember:  { x: 78 * 168, y: 62 * 168 }
  };

  function cellOf(id) {
    var ws = (SF.CONFIG && SF.CONFIG.worldSize) || 4200;
    var o = ORIGIN[id];
    if (!o) return null;
    return { x0: o.x, y0: o.y, x1: o.x + ws, y1: o.y + ws };
  }

  /* Absolute position of a local point in a region's frame. */
  function absOf(systemId, x, y) {
    var o = ORIGIN[systemId] || ORIGIN.solace;
    return { x: x + o.x, y: y + o.y };
  }

  /* Which region's cell contains an absolute point, or null (deep space).
   * Half-open intervals: shared edges belong to exactly one cell. */
  function regionAt(ax, ay) {
    var ids = Object.keys(ORIGIN);
    for (var i = 0; i < ids.length; i++) {
      var c = cellOf(ids[i]);
      if (ax >= c.x0 && ax < c.x1 && ay >= c.y0 && ay < c.y1) return ids[i];
    }
    return null;
  }

  function playerAbs() {
    try {
      var p = SF.Player, g = SF.Game;
      if (!p || !g) return null;
      return absOf(g.systemId, p.x, p.y);
    } catch (e) { return null; }
  }

  /* True when the player is outside every region cell. */
  function deepSpace() {
    var a = playerAbs();
    if (!a) return false;
    return regionAt(a.x, a.y) === null;
  }

  /* Absolute distance between two (systemId, x, y) points — used for
   * cross-region waypoint distances in the tracker. */
  function absDist(sysA, xA, yA, sysB, xB, yB) {
    var a = absOf(sysA, xA, yA), b = absOf(sysB, xB, yB);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* Shift every live entity from the old frame into the new frame.
   * Returns the shift applied ({dx, dy} in local coords). */
  function shiftEntities(dx, dy, newId) {
    var i, e;
    try {
      var p = SF.Player;
      p.x += dx; p.y += dy;
    } catch (e) {}
    try {
      var el = SF.Enemies.list;
      for (i = 0; i < el.length; i++) {
        e = el[i]; if (!e) continue;
        e.x += dx; e.y += dy;
        /* Raid wings: retarget to the new region's station if it has one
         * (the siege follows the player); otherwise degrade to a normal
         * patrol enemy and flee, so the origin raid's bookkeeping
         * (raidAlive: fled >1500u = routed) resolves instead of hanging. */
        if (e.raidSt) {
          var nst = null;
          try { nst = SF.Station ? SF.Station.getStation(newId) : null; } catch (err) {}
          if (nst) {
            e.raidSt = { x: nst.x, y: nst.y, sys: newId, name: nst.name };
          } else {
            e.raidSt = null; e.state = 'flee';
          }
        }
      }
    } catch (e) {}
    try {
      var pool = SF.Projectiles.pool;
      for (i = 0; i < pool.length; i++) {
        if (pool[i] && pool[i].active) { pool[i].x += dx; pool[i].y += dy; }
      }
    } catch (e) {}
    try {
      var pl = SF.Pickups.pool;
      for (i = 0; i < pl.length; i++) {
        if (pl[i] && pl[i].active) { pl[i].x += dx; pl[i].y += dy; }
      }
    } catch (e) {}
    try {
      if (SF.Companions && typeof SF.Companions.active === 'function') {
        var ws2 = SF.Companions.active() || [];
        for (i = 0; i < ws2.length; i++) {
          if (ws2[i] && typeof ws2[i].x === 'number') { ws2[i].x += dx; ws2[i].y += dy; }
        }
      }
    } catch (e) {}
    /* Particles are sub-second transient; they fade where they were. */
    return { dx: dx, dy: dy };
  }

  /* Seamless region transition. Called by main.js once per frame while
   * PLAYING; returns the camera shift ({dx, dy}) or null. */
  function checkCrossing() {
    try {
      var g = SF.Game, p = SF.Player;
      if (!g || !p || g.state !== 'PLAYING') return null;
      var cur = g.systemId;
      var a = playerAbs();
      if (!a) return null;
      var dest = regionAt(a.x, a.y);
      if (!dest || dest === cur) return null;
      var oCur = ORIGIN[cur] || ORIGIN.solace, oNew = ORIGIN[dest];
      var dx = oCur.x - oNew.x, dy = oCur.y - oNew.y;
      shiftEntities(dx, dy, dest);
      g.systemId = dest;
      if (g.discovered.indexOf(dest) < 0) {
        g.discovered.push(dest);
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Discovered: ' + SF.SYSTEM_BY_ID[dest].name);
      }
      /* Region content around the player (same as a jump arrival, minus
       * the spawn teleport and the entity wipe — the shift already moved
       * everything live). */
      var st = null;
      try { st = SF.Station ? SF.Station.getStation(dest) : null; } catch (e) {}
      var keepClear = st ? [{ x: st.x, y: st.y }] : [];
      try { if (SF.Asteroids) SF.Asteroids.init(dest, keepClear); } catch (e) {}
      try { if (SF.FX) SF.FX.setSystem(dest); } catch (e) {}
      try { if (SF.Encounters) SF.Encounters.reset(); } catch (e) {}
      try { if (SF.Wormholes) SF.Wormholes.onEnterSystem(dest); } catch (e) {}
      /* Music reads SF.Game.systemId (audio.js SF.Music) — the theme
       * swaps on its next tick with no call needed here. */
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Entering ' + SF.SYSTEM_BY_ID[dest].name);
      try { if (SF.Audio && SF.Audio.jump) SF.Audio.jump(); } catch (e) {}
      /* Save AFTER the shift so the stored position is in the new frame. */
      try { if (SF.Save) SF.Save.save(); } catch (e) {}
      return { dx: dx, dy: dy };
    } catch (e) { return null; }
  }

  /* Minimap window transform: player-centered, radius R world units.
   * Shared by drawMinimap, ThreatRings and NavMarks so all blips agree. */
  var MM_RADIUS = 1800;
  function minimapTransform(mm) {
    var W = mm.width, H = mm.height;
    var s = Math.min(W, H) / (2 * MM_RADIUS);
    return {
      sx: s, sy: s, cx: W / 2, cy: H / 2,
      x: function (wx) { return (wx - SF.Player.x) * s + W / 2; },
      y: function (wy) { return (wy - SF.Player.y) * s + H / 2; }
    };
  }

  return {
    ORIGIN: ORIGIN,
    cellOf: cellOf,
    absOf: absOf,
    regionAt: regionAt,
    playerAbs: playerAbs,
    deepSpace: deepSpace,
    absDist: absDist,
    checkCrossing: checkCrossing,
    shiftEntities: shiftEntities,
    minimapTransform: minimapTransform,
    MM_RADIUS: MM_RADIUS
  };
})();

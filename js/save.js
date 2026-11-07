/* STARFALL Phase 3 — save.js
 * localStorage save, versioned schema. Autosave on dock + travel, manual save button.
 * v2 adds ships, part inventory, weapon stars. v1 saves migrate on load.
 * v3 adds crew rosters per ship.
 */
window.SF = window.SF || {};

/* twelve-hour-wave3 (B4): the canonical SF.SAVE_VERSION assignment lives
 * ONLY in js/data.js (end of file). This file deliberately does NOT
 * assign it anymore: the old save.js assignment (12) only won because
 * save.js loads after data.js, and a script reorder would silently hand
 * the version to whatever literal ran last. Fail loudly instead of
 * overwriting: if the value is ever wrong, the console says so and the
 * save path still refuses to stamp a wrong version silently — collect()
 * below writes SF.SAVE_VERSION as-is, and valid() rejects anything
 * outside v1..v12, so a wrong value fails closed at load, never as a
 * corrupt save. (If data.js never loaded at all, the game has no data
 * and nothing here can save it; the warning is the honest signal.) */
if (typeof SF.SAVE_VERSION !== 'number' || SF.SAVE_VERSION !== 12) {
  if (typeof console !== 'undefined' && console.warn)
    console.warn('[save] SF.SAVE_VERSION is ' + SF.SAVE_VERSION +
      ', expected 12 — canonical assignment lives in js/data.js');
}

SF.Save = (function () {
  var KEY = 'starfall_save_v1';

  function collect() {
    var g = SF.Game;
    return {
      version: SF.SAVE_VERSION,
      savedAt: Date.now(),
      system: g.systemId,
      discovered: g.discovered.slice(),
      player: SF.Player.serialize(),
      /* defense-grid-1: owned-station (homebase) defense grid, or null.
       * NPC-station grids are session-only by design and never saved. */
      defense: (window.SF && SF.Raids && SF.Raids.serializeDefense)
        ? SF.Raids.serializeDefense() : null
    };
  }

  function migrate(d) {
    if (!d) return null;
    if (d.version === 1) {
      d.player = SF.Player.migrateV1(d.player);
      d.version = 2;
    }
    if (d.version === 2) {
      d.player = SF.Player.migrateV2(d.player);
      d.version = 3;
    }
    if (d.version === 3) {
      d.player = SF.Player.migrateV3(d.player);
      d.version = 4;
    }
    if (d.version === 4) {
      d.player = SF.Player.migrateV4(d.player);
      d.version = 5;
    }
    /* weapons-arsenal phase: v5 -> v6 (weapon mod slots + mod inventory). */
    if (d.version === 5) {
      d.player = SF.Player.migrateV5(d.player);
      d.version = 6;
    }
    /* story-campaign phase: v6 -> v7 (story campaign progress blob). */
    if (d.version === 6) {
      d.player = SF.Player.migrateV6(d.player);
      d.version = 7;
    }
    /* secrets-easter-eggs phase: v7 -> v8 (secrets2 anomaly/dungeon/lifepod state). */
    if (d.version === 7) {
      d.player = SF.Player.migrateV7(d.player);
      d.version = 8;
    }
    /* gameplay-depth phase: v8 -> v9 (bounty board state). */
    if (d.version === 8) {
      d.player = SF.Player.migrateV8(d.player);
      d.version = 9;
    }
    /* planets-facilities phase: v9 -> v10 (news feed, contraband, black market). */
    if (d.version === 9) {
      d.player = SF.Player.migrateV9(d.player);
      d.version = 10;
    }
    /* skills-system-retry phase: v10 -> v11 (skills blob; migrateV10 lives in
     * js/skills.js since js/ship.js is outside this phase's file scope). */
    if (d.version === 10) {
      d.player = SF.Player.migrateV10(d.player);
      d.version = 11;
    }
    /* defense-grid-1 phase: v11 -> v12 (defense grid blob). Old saves get
     * a null blob: no homebase grid exists yet, grids start empty — the
     * homebase itself (if any) is untouched in the player blob. */
    if (d.version === 11) {
      if (d.defense === undefined) d.defense = null;
      d.version = 12;
    }
    return d;
  }

  function valid(d) {
    return d && (d.version === 1 || d.version === 2 || d.version === 3 ||
                 d.version === 4 || d.version === 5 || d.version === 6 ||
                 d.version === 7 || d.version === 8 || d.version === 9 ||
                 d.version === 10 || d.version === 11 || d.version === 12) && d.player;
  }

  function apply(d) {
    d = migrate(d);
    SF.Game.systemId = d.system;
    SF.Game.discovered = d.discovered.slice();
    SF.Player.deserialize(d.player);
    /* defense-grid-1: restore the owned station's grid AFTER the player
     * blob (the homebase record itself lives in the player blob, and
     * restoreDefense resolves the station through it). */
    if (window.SF && SF.Raids && SF.Raids.restoreDefense) {
      SF.Raids.restoreDefense(d.defense || null);
    }
  }

  return {
    has: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return false;
        return valid(JSON.parse(raw));
      } catch (e) { return false; }
    },

    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(collect()));
        return true;
      } catch (e) { return false; }
    },

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return false;
        var d = JSON.parse(raw);
        if (!valid(d)) return false;
        var v0 = d.version;
        apply(d);
        if (d.version !== v0) SF.Save.save(); // persist migrated save
        return true;
      } catch (e) { return false; }
    },

    wipe: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})();

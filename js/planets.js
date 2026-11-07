/* ============================================================
 * STARFALL — planets-facilities phase
 *
 * SF.Planets: dockable planets — LAND takes the player to a surface
 * view (planet art + ground facilities: bar, black market, repair
 * yard, news board), then LAUNCH back to orbit.
 * SF.HQ: the three faction capital stations (Aegis Citadel, Karavan
 * Prime, Ashen Throne) with unique requisition inventories, faction
 * services, and black markets where the faction tolerates them.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  /* ---------------- v2-celestial-wiring: optimized sprite tables ----------------
   * Sprite ids under assets/sprites/celestial/{planets,moons}/<id>.png and
   * assets/sprites/biomes/<id>.png (PNG-8 game-ready copies, see V2-SPRITES.md
   * and tools/v2-sprite-manifest.json). The data model (js/data.js) names no
   * biome, so the mapping is curated here; a pl.biome / pl.spriteId field
   * would take precedence if a future data phase adds one. Save-neutral: pure
   * render mapping, nothing persisted. */
  var V2_PLANET_SPRITE = {
    verdant: 'terrestrial',   // agri-world
    rustanch: 'desert',       // rust-belt mining colony
    kestrel: 'ocean',         // free-port boomtown
    shatters: 'tidal',        // shattered planetoid, scorched/frozen halves
    cinder: 'lava',           // volcanic forge-world
    deadlight: 'life-bearing' // irradiated graveyard of a dead fleet
  };
  var V2_MOON_SPRITE = {
    verdant: 'rocky', rustanch: 'captured-asteroid', kestrel: 'gas',
    shatters: 'binary', cinder: 'lava', deadlight: 'crystal'
  };
  var V2_BIOME = {
    verdant: 'forest', rustanch: 'canyon', kestrel: 'ocean',
    shatters: 'wasteland', cinder: 'volcanic', deadlight: 'caves'
  };

  /* ---------------- planet-sprites-3: new worlds + station variants ----------------
   * 8 new planet sprites (assets/sprites/planets/<id>.png) + 4 new station
   * sprites (assets/sprites/stations/<id>.png), PNG-8 512x512, dark palette
   * with rim lighting.
   * Worlds register into SF.PLANETS / SF.PLANET_BY_ID at load (idempotent —
   * the coordinator may merge this file over a tree that already has them);
   * they then ride the existing station.js routes unchanged: allStations()
   * dock prompts, nearStation(), land(), render(), drawOne(). Station
   * variants append to SF.FACTION_HQ / SF.HQ_BY_ID (idempotent) as minor
   * stations (kind 'v3minor'); SF.HQ.drawOne resolves art via
   * SF.Sprites.get('stations', hq.id) and keeps its procedural bastion
   * fallback for misses. factions.js hqOf() still returns the capitals (ours
   * append after), quest boards key by hqId so there are no collisions.
   * Save-neutral: no persisted fields, SAVE_VERSION stays v11.
   * `weight` = per-system spawn weight; v3Worlds()/v3Stations() return the
   * entries sorted by weight desc (a future dynamic-spawn phase can sample
   * the table instead of taking all of them). */
  var V3_PLANET_IDS = ['inferno', 'crystalis', 'venom', 'fracture',
    'annulus', 'pelagic', 'dunewake', 'mycor'];
  var V3_STATION_IDS = ['embassy_ring_2', 'drydock_crane', 'listening_post',
    'trade_hub_2'];
  var V3_PLANET_SPRITE = {
    inferno: 'inferno', crystalis: 'crystalis', venom: 'venom',
    fracture: 'fracture', annulus: 'annulus', pelagic: 'pelagic',
    dunewake: 'dunewake', mycor: 'mycor'
  };

  var V3_WORLDS = [
    { id: 'inferno', name: 'Infernos', systemId: 'ember', weight: 40,
      x: 900, y: 1300, color: '#ff7a2e', spriteId: 'inferno',
      desc: 'A world still being born. Rivers of lava, skies of ash \u2014 the Pact forges its warships on these shores.',
      faction: 'ember', facilities: ['bar', 'repair'], goods: ['fuel', 'minerals'] },
    { id: 'fracture', name: 'Fracture', systemId: 'ember', weight: 25,
      x: 3300, y: 2400, color: '#c98a5a', spriteId: 'fracture',
      desc: 'A planet that lost an argument with physics. Claim jumpers work the shards; nobody asks what broke it.',
      faction: null, facilities: ['blackmarket', 'repair'], goods: ['minerals', 'elec'] },
    { id: 'crystalis', name: 'Crystalis', systemId: 'drift', weight: 35,
      x: 950, y: 2900, color: '#9fd4e8', spriteId: 'crystalis',
      desc: 'A glittering ice-crystal world. Drifters mine the facets for optics and sell the shine back to the core.',
      faction: 'drifters', facilities: ['bar', 'repair', 'news'], goods: ['lux', 'minerals'] },
    { id: 'venom', name: 'Venom', systemId: 'drift', weight: 30,
      x: 2950, y: 1100, color: '#a8d93a', spriteId: 'venom',
      desc: 'Toxic atmosphere, priceless chemistry. The air will kill you; the extracts will make you rich.',
      faction: null, facilities: ['blackmarket', 'repair'], goods: ['meds', 'fuel'] },
    { id: 'dunewake', name: 'Dunewake', systemId: 'drift', weight: 20,
      x: 2600, y: 650, color: '#d8a860', spriteId: 'dunewake',
      desc: 'Desert canyons and buried water. Caravans cross the dunes; the wise ones pay the guides.',
      faction: 'drifters', facilities: ['bar', 'news'], goods: ['food', 'minerals'] },
    { id: 'pelagic', name: 'Pelagos', systemId: 'solace', weight: 35,
      x: 650, y: 2000, color: '#3f9fe0', spriteId: 'pelagic',
      desc: 'An ocean world under Compact charter. The fishing fleets are armed; the storms are worse.',
      faction: 'compact', facilities: ['bar', 'repair', 'news'], goods: ['food', 'lux'] },
    { id: 'annulus', name: 'Annulus', systemId: 'solace', weight: 25,
      x: 3550, y: 1950, color: '#7fc4c9', spriteId: 'annulus',
      desc: 'A ringed gas giant. Skimmers harvest volatiles from the upper bands; the rings hide older wrecks.',
      faction: null, facilities: ['repair', 'news'], goods: ['fuel', 'elec'] },
    { id: 'mycor', name: 'Mycor', systemId: 'solace', weight: 20,
      x: 1700, y: 3550, color: '#b48ae0', spriteId: 'mycor',
      desc: 'A fungal world that glows at night. The spores are worth a fortune and the dreams are free.',
      faction: 'drifters', facilities: ['bar', 'blackmarket'], goods: ['meds', 'lux'] }
  ];

  var V3_STATIONS = [
    { id: 'embassy_ring_2', name: 'Compact Embassy Ring', kind: 'v3minor',
      factionId: 'compact', systemId: 'solace', weight: 30, x: 1500, y: 1200,
      blurb: 'The Compact\u2019s diplomatic ring. Treaties are signed here; grudges are merely postponed.',
      inventory: [], bm: false, stock: ['aegis_generator', 'composite_armor'] },
    { id: 'drydock_crane', name: 'Drifter Drydock', kind: 'v3minor',
      factionId: 'drifters', systemId: 'drift', weight: 30, x: 2950, y: 2900,
      blurb: 'Twin cranes, one honest mechanic, forty dishonest ones. Hulls rebuilt while you wait.',
      inventory: [], bm: false, stock: ['fusion_drive', 'freight_bay'] },
    { id: 'listening_post', name: 'Ember Listening Post', kind: 'v3minor',
      factionId: 'ember', systemId: 'ember', weight: 25, x: 3050, y: 1350,
      blurb: 'The Pact hears everything eventually. The dishes never sleep; neither do the analysts.',
      inventory: [], bm: false, stock: ['flak', 'storm'] },
    { id: 'trade_hub_2', name: 'Freeport Exchange', kind: 'v3minor',
      factionId: 'drifters', systemId: 'drift', weight: 35, x: 1250, y: 1350,
      blurb: 'Six spokes, six thousand deals a day. The Exchange takes its cut and asks no questions.',
      inventory: [], bm: true, stock: ['repeater', 'scatter'] }
  ];

  (function registerV3() {
    if (!window.SF || !SF.PLANETS || !SF.FACTION_HQ) return;
    var i;
    if (SF.PLANET_BY_ID) {
      for (i = 0; i < V3_WORLDS.length; i++) {
        if (!SF.PLANET_BY_ID[V3_WORLDS[i].id]) {
          SF.PLANETS.push(V3_WORLDS[i]);
          SF.PLANET_BY_ID[V3_WORLDS[i].id] = V3_WORLDS[i];
        }
      }
    }
    for (i = 0; i < V3_STATIONS.length; i++) {
      var dup = false, j;
      for (j = 0; j < SF.FACTION_HQ.length; j++) {
        if (SF.FACTION_HQ[j].id === V3_STATIONS[i].id) { dup = true; break; }
      }
      if (!dup) {
        SF.FACTION_HQ.push(V3_STATIONS[i]);
        if (SF.HQ_BY_ID) SF.HQ_BY_ID[V3_STATIONS[i].id] = V3_STATIONS[i];
      }
    }
  })();

  /* ---------------- backgrounds-wiring-2: planet-surface vista layers ----------------
   * Vista ids under assets/bg/<id>.webp (2048x2048; surface_* from
   * backgrounds-4, see phases/backgrounds-4/REPORT.md; kestrel's
   * solace_aurora from backgrounds-6). Direct <img> paths — NOT SF.Sprites,
   * which assumes assets/sprites/. Mounted as the bottom layer of the
   * surface-art div in render(); the biome tile stays on top as a fallback.
   * Save-neutral: pure render mapping, nothing persisted. */
  var V2_SURFACE_VISTA = {
    verdant: 'surface_solace_fields',   // agri-world
    rustanch: 'surface_drift_canyon',   // rust-belt mining colony
    kestrel: 'solace_aurora',           // backgrounds-wiring-3: ocean boomtown aurora vista (vol 6)
    shatters: 'surface_drift_wastes',   // shattered planetoid
    cinder: 'surface_ember_volcanic',   // volcanic forge-world
    deadlight: 'surface_ember_ruins'    // irradiated fleet graveyard
    // surface_solace_crystal: unassigned by design — reserved for a future crystal world
  };

  /* ---------------- backgrounds-wiring-3: system vista layers (vols 5-7) ----------------
   * System-keyed nebula vistas from backgrounds-5 (see phases/backgrounds-5/
   * REPORT.md 'Notes for the next phase' for the suggested system mapping).
   * Direct <img> paths under assets/bg/ — NOT SF.Sprites, which assumes
   * assets/sprites/. Mounted in render() as the BOTTOM layer of the
   * surface-art div (behind the planet surface vista), at lower opacity so
   * the planet art stays dominant. Low quality tier: skipped entirely
   * (procedural gradient only). Save-neutral: pure render mapping, nothing
   * persisted. The remaining vols 5/6/7 layers are anomaly/arena/dungeon/
   * battlefield backdrops — they belong to the views that own those screens
   * and are noted in REPORT.md for their own wiring phases. */
  var V3_SYSTEM_VISTA = {
    solace: 'verdant_expanse',  // lush teal/green safe-zone backdrop (vol 5)
    drift: 'hollow_drift',      // dark hollow core, anomaly-site mood (vol 5)
    ember: 'ember_reef'         // ember-coral reef filaments (vol 5)
  };

  var _v2Preloaded = false;
  function preloadV2() {
    if (_v2Preloaded || !(window.SF && SF.Sprites)) return;
    _v2Preloaded = true;
    function ids(t) { var out = [], seen = {}; for (var k in t) if (!seen[t[k]]) { seen[t[k]] = 1; out.push(t[k]); } return out; }
    SF.Sprites.preload('celestial/planets', ids(V2_PLANET_SPRITE));
    SF.Sprites.preload('celestial/moons', ids(V2_MOON_SPRITE));
    SF.Sprites.preload('biomes', ids(V2_BIOME));
    /* planet-sprites-3: warm the new world + station-variant art. */
    SF.Sprites.preload('planets', V3_PLANET_IDS);
    SF.Sprites.preload('stations', V3_STATION_IDS);
    /* backgrounds-wiring-3: warm the vista <img> cache — direct assets/bg/
     * paths, NOT SF.Sprites (which assumes assets/sprites/). */
    ids(V2_SURFACE_VISTA).concat(ids(V3_SYSTEM_VISTA)).forEach(function (id) {
      try { var im = new Image(); im.src = 'assets/bg/' + id + '.webp'; } catch (e) {}
    });
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* ---------------- surface-props-wiring: planet surface prop layer ----------------
   * The 18 surface prop sprites under assets/sprites/surface/ (produced by
   * surface-props-retry; PNG-8, transparent) are composited into the landing
   * view as a <canvas> layer inside .surface-art: above the vista <img>
   * stack, below the name/desc text (z-index 1). Pads sit under the player's
   * landed ship, crystals/wrecks/flora/rocks scatter biome-appropriately,
   * crates + beacons cluster near outposts (repair yards / black markets).
   * Layout is deterministic per planet id (seeded RNG) — pure render mapping,
   * nothing persisted, save schema untouched (stays v11). Rendering goes
   * through SF.Sprites.get('surface', id) with a canvas-drawn fallback per
   * prop category when a file is missing or still decoding; paintProps
   * repaints a few times so sprites pop in once ready. Test hooks:
   * surfacePropIds(), surfaceProps(pl), surfaceStats(). */
  var SURFACE_PROP_IDS = [
    'pad_1', 'pad_2',
    'crystal_1', 'crystal_2',
    'wreck_1', 'wreck_2',
    'flora_forest', 'flora_desert', 'flora_volcanic', 'flora_icecaves',
    'rock_tundra', 'rock_canyon', 'rock_wasteland', 'rock_crater',
    'crate_1', 'crate_2',
    'beacon_1', 'beacon_2'
  ];

  /* role: pad = landing platform (player ship drawn on the first pad);
   * scatter = biome dressing, painter-sorted by y; outpost = crates/beacons
   * clustered around the main pad. Counts keep the view readable (~12-18
   * draws) — depth over sprawl. */
  var SURFACE_PROPS = {
    verdant:   { pads: ['pad_1'], scatter: [['flora_forest', 7], ['crystal_1', 2], ['rock_tundra', 2]], outpost: ['crate_1', 'crate_1', 'beacon_1'] },
    rustanch:  { pads: ['pad_2'], scatter: [['rock_canyon', 7], ['flora_desert', 3], ['wreck_2', 2]],  outpost: ['crate_2', 'crate_2', 'beacon_1'] },
    kestrel:   { pads: ['pad_1'], scatter: [['flora_forest', 4], ['rock_crater', 3], ['crystal_1', 1]], outpost: ['crate_1', 'crate_2', 'beacon_1'] },
    shatters:  { pads: [],        scatter: [['rock_crater', 6], ['rock_wasteland', 5], ['wreck_1', 1], ['wreck_2', 3]], outpost: [] },
    cinder:    { pads: ['pad_2'], scatter: [['flora_volcanic', 6], ['rock_wasteland', 4], ['crystal_2', 2]], outpost: ['beacon_2'] },
    deadlight: { pads: [],        scatter: [['wreck_1', 2], ['wreck_2', 4], ['crystal_2', 3], ['rock_wasteland', 3]], outpost: ['beacon_2'] }
  };

  function propCat(id) { return String(id).split('_')[0]; } // pad|crystal|wreck|flora|rock|crate|beacon

  function propRng(seed) {
    var a = seed | 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Flat resolved prop list for a planet: [{id, cat, role}]. Unknown planet
   * ids resolve to [] (view renders clean, no props). */
  function resolveProps(pl) {
    var cfg = (pl && SURFACE_PROPS[pl.id]) || null;
    var out = [];
    if (!cfg) return out;
    cfg.pads.forEach(function (id) { out.push({ id: id, cat: propCat(id), role: 'pad' }); });
    cfg.scatter.forEach(function (pair) {
      for (var i = 0; i < pair[1]; i++) out.push({ id: pair[0], cat: propCat(pair[0]), role: 'scatter' });
    });
    cfg.outpost.forEach(function (id) { out.push({ id: id, cat: propCat(id), role: 'outpost' }); });
    return out;
  }

  function _poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  /* Canvas-drawn fallback for a prop, drawn centered at the origin in a
   * 100-unit box (caller translates/rotates/scales). Used while the sprite
   * is decoding or when the file is missing — the view never breaks. */
  function drawPropFallback(ctx, id, rng) {
    var cat = propCat(id);
    ctx.save();
    if (cat === 'pad') {
      ctx.fillStyle = '#2a3040'; ctx.strokeStyle = '#55617a'; ctx.lineWidth = 4;
      _poly(ctx, [[-45, -18], [-18, -45], [18, -45], [45, -18], [45, 18], [18, 45], [-18, 45], [-45, 18]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#161b28';
      _poly(ctx, [[-32, -13], [-13, -32], [13, -32], [32, -13], [32, 13], [13, 32], [-13, 32], [-32, 13]]);
      ctx.fill();
      ctx.fillStyle = '#8fd8ff'; ctx.font = 'bold 30px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', 0, 2);
      ctx.fillStyle = (id === 'pad_2') ? '#ff5e5e' : '#7df9ff';
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 44, Math.sin(a) * 44, 3.5, 0, 7); ctx.fill();
      }
    } else if (cat === 'crystal') {
      var c1 = (id === 'crystal_2') ? '#b45cff' : '#7df9ff';
      var c2 = (id === 'crystal_2') ? '#5a2d99' : '#1d6f8f';
      for (var k = 0; k < 4; k++) {
        var w = 10 + rng() * 14, h = 30 + rng() * 40;
        var ox = (rng() - 0.5) * 50, tilt = (rng() - 0.5) * 0.7;
        var g = ctx.createLinearGradient(0, 30, 0, 30 - h);
        g.addColorStop(0, c2); g.addColorStop(1, c1);
        ctx.fillStyle = g;
        ctx.save(); ctx.translate(ox, 28); ctx.rotate(tilt);
        _poly(ctx, [[-w / 2, 0], [w / 2, 0], [0, -h]]); ctx.fill();
        ctx.restore();
      }
    } else if (cat === 'wreck') {
      ctx.fillStyle = '#3a3f4d';
      _poly(ctx, [[-48, -10], [-20, -34], [18, -26], [46, -8], [30, 22], [-14, 30], [-44, 16]]);
      ctx.fill();
      ctx.strokeStyle = '#14161d'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#23262f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-30, -4); ctx.lineTo(10, 8); ctx.moveTo(-8, -22); ctx.lineTo(24, -2); ctx.stroke();
      if (id === 'wreck_1') { // ember cavity
        ctx.fillStyle = 'rgba(255,110,40,0.85)';
        _poly(ctx, [[-12, -8], [8, -14], [2, 10], [-16, 6]]); ctx.fill();
      }
    } else if (cat === 'flora') {
      if (id === 'flora_forest') {
        ctx.strokeStyle = '#5a3d26'; ctx.lineWidth = 5;
        [[-24, 0], [0, 6], [24, 0]].forEach(function (p) {
          ctx.beginPath(); ctx.moveTo(p[0], 30); ctx.lineTo(p[0] + p[1], 2); ctx.stroke();
        });
        ctx.fillStyle = '#2e7d3a';
        [[-26, -12, 18], [0, -20, 22], [24, -10, 16]].forEach(function (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, 7); ctx.fill();
        });
        ctx.fillStyle = '#46b455';
        [[-26, -18], [0, -26], [24, -16]].forEach(function (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, 7); ctx.fill();
        });
      } else if (id === 'flora_desert') {
        ctx.fillStyle = '#3f8f4f';
        ctx.fillRect(-8, -30, 16, 58);
        ctx.fillRect(-26, -20, 18, 8); ctx.fillRect(-26, -20, 8, 22);
        ctx.fillRect(8, -12, 18, 8); ctx.fillRect(18, -12, 8, 18);
        ctx.fillStyle = '#63b56f'; ctx.fillRect(-8, -30, 6, 58);
      } else if (id === 'flora_volcanic') {
        ctx.fillStyle = '#23242c';
        for (var s = 0; s < 5; s++) {
          var sx = -36 + s * 18, sh = 26 + rng() * 30;
          _poly(ctx, [[sx - 8, 30], [sx + 8, 30], [sx + (rng() - 0.5) * 10, 30 - sh]]); ctx.fill();
        }
        ctx.strokeStyle = '#ff7a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-20, 30); ctx.lineTo(-8, 2); ctx.moveTo(12, 30); ctx.lineTo(20, 6); ctx.stroke();
      } else { // flora_icecaves
        ctx.fillStyle = '#9fd4e8';
        for (var q = 0; q < 4; q++) {
          var qx = -30 + q * 20, qh = 30 + rng() * 34;
          _poly(ctx, [[qx - 9, 30], [qx + 9, 30], [qx + (rng() - 0.5) * 8, 30 - qh]]); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        _poly(ctx, [[-32, 30], [-24, 30], [-28, -6]]); ctx.fill();
      }
    } else if (cat === 'rock') {
      ctx.fillStyle = '#4c5261';
      _poly(ctx, [[-40, 14], [-28, -18], [-6, -30], [22, -22], [40, -2], [30, 20], [-8, 26]]);
      ctx.fill();
      ctx.fillStyle = '#3a3f4b';
      _poly(ctx, [[-40, 14], [-8, 26], [30, 20], [34, 30], [-20, 32]]);
      ctx.fill();
      if (id === 'rock_tundra') {
        ctx.fillStyle = '#dfe8f2';
        ctx.beginPath(); ctx.ellipse(-4, -22, 26, 10, -0.2, 0, 7); ctx.fill();
      } else if (id === 'rock_canyon') {
        ctx.strokeStyle = 'rgba(20,14,10,0.6)'; ctx.lineWidth = 3;
        for (var l = 0; l < 3; l++) {
          ctx.beginPath(); ctx.moveTo(-34, -6 + l * 12); ctx.quadraticCurveTo(0, -2 + l * 12, 34, -8 + l * 12); ctx.stroke();
        }
      } else if (id === 'rock_wasteland') {
        ctx.fillStyle = '#8a4a2a';
        [[-14, -8, 5], [10, 2, 7], [-2, 14, 4]].forEach(function (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, 7); ctx.fill();
        });
      } else if (id === 'rock_crater') {
        ctx.fillStyle = '#33363f';
        _poly(ctx, [[-30, -20], [-14, -40], [2, -24], [18, -42], [30, -22]]);
        ctx.fill();
      }
    } else if (cat === 'crate') {
      ctx.fillStyle = (id === 'crate_1') ? '#5a6234' : '#6e4a30';
      ctx.fillRect(-30, -22, 60, 44);
      ctx.strokeStyle = '#20242e'; ctx.lineWidth = 4;
      ctx.strokeRect(-30, -22, 60, 44);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.stroke();
      if (id === 'crate_1') { // hazard band
        ctx.save();
        ctx.beginPath(); ctx.rect(-30, 8, 60, 10); ctx.clip();
        ctx.fillStyle = '#e8c33a'; ctx.fillRect(-30, 8, 60, 10);
        ctx.fillStyle = '#20242e';
        for (var b = -30; b < 30; b += 12) {
          _poly(ctx, [[b, 8], [b + 6, 8], [b + 2, 18], [b - 4, 18]]); ctx.fill();
        }
        ctx.restore();
      } else { // rusted civilian container: rust spots + stencil
        ctx.fillStyle = '#7d3f22';
        [[-16, -8, 5], [12, 6, 6], [2, -14, 4]].forEach(function (p) {
          ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, 7); ctx.fill();
        });
        ctx.fillStyle = 'rgba(230,230,220,0.5)'; ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center'; ctx.fillText('SUP', 0, -2);
      }
    } else if (cat === 'beacon') {
      ctx.fillStyle = '#39404f'; ctx.fillRect(-7, -34, 14, 62);
      ctx.fillStyle = '#2b3040'; ctx.fillRect(-20, 22, 40, 10);
      ctx.strokeStyle = '#20242e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, -20); ctx.lineTo(7, -20); ctx.moveTo(-7, -6); ctx.lineTo(7, -6); ctx.stroke();
      var dc = (id === 'beacon_1') ? '255,170,60' : '255,80,80';
      var glow = ctx.createRadialGradient(0, -40, 2, 0, -40, 28);
      glow.addColorStop(0, 'rgba(' + dc + ',0.9)');
      glow.addColorStop(1, 'rgba(' + dc + ',0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, -40, 28, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(' + dc + ')';
      ctx.beginPath(); ctx.arc(0, -40, 9, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  var _propStats = { expected: 0, sprite: 0, fallback: 0, shipSprite: false };

  /* surface-props-retry shipped the 18 sprites with OPAQUE BLACK backgrounds
   * (its REPORT claims tRNS transparency, but every file's tRNS chunk is all
   * 0xFF and all four corners sample pure (0,0,0) — verified 2026-10-21).
   * Until an asset phase re-exports them with real transparency, key pure
   * black to transparent once per sprite id into a cached offscreen canvas.
   * The generator painted art in non-black palette entries, so only the
   * background keys out; the baked scorch field on the wrecks keys out too,
   * which reads correctly as scorched ground. If a future asset phase fixes
   * the files, this becomes a cheap no-op copy — drop it then. */
  var _keyedCache = {}; // surface id -> keyed canvas (only set once built)
  function keyedPropSprite(id) {
    if (_keyedCache[id]) return _keyedCache[id];
    if (!(window.SF && SF.Sprites) || !SF.Sprites.ready('surface', id)) return null;
    var img = SF.Sprites.get('surface', id);
    if (!img || !img.naturalWidth) return null;
    try {
      var cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      var d = cx.getImageData(0, 0, cv.width, cv.height);
      var px = d.data;
      for (var i = 0; i < px.length; i += 4) {
        if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) px[i + 3] = 0;
      }
      cx.putImageData(d, 0, 0);
      _keyedCache[id] = cv;
      return cv;
    } catch (e) { return null; } // canvas tainted etc: caller keeps fallback
  }

  /* Player's landed ship, drawn on the main pad (sprite-first; the 'ships'
   * PNGs are authored nose-up, like drawSpriteHull in ship.js). */
  function drawLandedShip(ctx, anchor, hasPad, stats) {
    if (!hasPad) return;
    var shipId = null;
    try {
      if (window.SF && SF.Player && SF.Player.activeShipDef) shipId = SF.Player.activeShipDef().classId;
    } catch (e) { shipId = null; }
    var img = (shipId && window.SF && SF.Sprites) ? SF.Sprites.get('ships', shipId) : null;
    var ss = anchor.s * 0.42;
    ctx.save();
    ctx.translate(anchor.x, anchor.y - anchor.s * 0.05);
    if (img) {
      ctx.drawImage(img, -ss / 2, -ss / 2, ss, ss);
      stats.shipSprite = true;
    } else {
      ctx.fillStyle = '#9fb4d8';
      _poly(ctx, [[0, -ss / 2], [ss * 0.32, ss / 2], [0, ss * 0.28], [-ss * 0.32, ss / 2]]);
      ctx.fill();
      ctx.fillStyle = '#dfe9ff';
      _poly(ctx, [[0, -ss / 2], [ss * 0.12, ss * 0.1], [-ss * 0.12, ss * 0.1]]);
      ctx.fill();
    }
    ctx.restore();
  }

  /* Paint the prop layer. attempt/token: render() bumps art._propToken per
   * render so stale retries (e.g. after liftoff) no-op; retries let sprites
   * pop in once decoded and re-layout after the overlay becomes visible. */
  function paintSurfaceProps(cv, pl, attempt, token) {
    var art = cv.parentNode;
    if (!art || art._propToken !== token) return; // stale render
    var laidOut = art.clientWidth > 40;
    var W = laidOut ? art.clientWidth : 900;
    var H = laidOut ? Math.max(180, art.clientHeight) : 300;
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var cfg = resolveProps(pl);
    var rng = propRng(hashStr(pl.id + ':props'));
    var s0 = Math.min(W, H);
    var i, e;
    var draws = [];
    var padX = [0.5, 0.24, 0.76];
    for (i = 0; i < cfg.length; i++) {
      e = cfg[i];
      if (e.role !== 'pad') continue;
      var pi = draws.length;
      draws.push({
        id: e.id, x: W * (padX[pi % padX.length] + (rng() - 0.5) * 0.06),
        y: H * (0.78 + (rng() - 0.5) * 0.06),
        s: s0 * (pi === 0 ? 0.62 : 0.44), rot: (rng() - 0.5) * 0.3,
        main: pi === 0, role: 'pad'
      });
    }
    var anchor = draws.length ?
      { x: draws[0].x, y: draws[0].y, s: draws[0].s } : null;
    var ax = anchor ? anchor.x : W * 0.5, ay = anchor ? anchor.y : H * 0.8;
    var as = anchor ? anchor.s : s0 * 0.5;
    for (i = 0; i < cfg.length; i++) {
      e = cfg[i];
      if (e.role === 'pad') continue;
      var x, y, sc;
      if (e.role === 'outpost') {
        x = ax + (rng() - 0.5) * as * 1.7;
        y = ay + (rng() - 0.5) * as * 0.9 - as * 0.18;
        sc = s0 * (e.cat === 'beacon' ? 0.34 : 0.20) * (0.85 + rng() * 0.3);
      } else {
        x = W * (0.05 + rng() * 0.90);
        y = H * (0.52 + rng() * 0.44);
        sc = s0 * (e.cat === 'wreck' ? 0.30 : e.cat === 'crystal' ? 0.22 : 0.16) * (0.5 + rng() * 1.0);
      }
      draws.push({ id: e.id, x: x, y: y, s: sc, rot: (rng() - 0.5) * 1.0, role: e.role });
    }
    // painter order: pads first, then back-to-front by y
    draws.sort(function (a, b) {
      return (a.role === 'pad' ? -1e9 : a.y) - (b.role === 'pad' ? -1e9 : b.y);
    });
    var stats = { expected: cfg.length, sprite: 0, fallback: 0, shipSprite: false };
    var pending = 0;
    draws.forEach(function (d) {
      // black-keyed sprite canvas when the file is decoded, else the
      // canvas-drawn fallback (loader contract: never break on a miss)
      var img = keyedPropSprite(d.id);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      // soft contact shadow under every prop
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(0, d.s * 0.32, d.s * 0.36, d.s * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
      if (img) {
        ctx.drawImage(img, -d.s / 2, -d.s / 2, d.s, d.s);
        stats.sprite++;
      } else {
        ctx.save(); ctx.scale(d.s / 100, d.s / 100);
        drawPropFallback(ctx, d.id, rng);
        ctx.restore();
        stats.fallback++;
        pending++;
      }
      ctx.restore();
    });
    drawLandedShip(ctx, anchor || { x: ax, y: ay, s: as }, !!anchor, stats);
    _propStats = stats;
    // Retry while sprites are still decoding (cold first land), while the
    // overlay hasn't laid out yet, or for the attempt-0 post-show repaint.
    // Cap at 20 attempts (~7s) so a genuinely missing file settles into its
    // canvas fallback instead of repainting forever.
    if (attempt < 20 && (pending > 0 || !laidOut || attempt === 0)) {
      setTimeout(function () { paintSurfaceProps(cv, pl, attempt + 1, token); }, attempt === 0 ? 80 : 350);
    }
  }

  /* ---------------- interiors-wiring: station interior backdrop table ----------------
   * Backdrop ids under assets/bg/interiors/<id>.webp (2048x2048 webp, see
   * phases/station-interiors-1/REPORT.md). Direct <img> paths — NOT the
   * SF.Sprites loader, which assumes assets/sprites/. Save-neutral: pure
   * render mapping, nothing persisted. The market/shipyard/bar/blackmarket
   * keys are reserved for a future service-view phase that touches those
   * modules; station.js (store overlay) and the HQ render below consume
   * hangar/compact/drifters/ember. */
  var V2_INTERIOR = {
    hangar: 'hangar_bay',
    market: 'market_hall',
    shipyard: 'shipyard',
    bar: 'cantina_bar',
    blackmarket: 'blackmarket_den',
    compact: 'hq_compact',
    drifters: 'hq_drifters',
    ember: 'hq_ember',
    /* interiors-wiring-2 (2026-10-21): rounds 2+3 backdrop keys. Every id is
     * the exact asset filename from phases/interiors-2/REPORT.md or
     * phases/interiors-3/REPORT.md — do not add ids without a matching
     * assets/bg/interiors/<id>.webp file. */
    medbay: 'dock_medical_bay',
    customs: 'dock_customs_gate',
    observatory: 'promenade_observatory',
    embassy_aegis: 'embassy_aegis',
    embassy_ashen: 'embassy_ashen',
    bazaar: 'undercity_bazaar',
    homebase: 'homebase_command_deck',
    arena: 'arena_pit',
    contracts: 'contract_hub',
    sanctum: 'dungeon_sanctum',
    smuggler: 'smuggler_cove',
    wormhole: 'wormhole_lab',
    chart: 'chart_room',
    cargo: 'cargo_hold'
  };

  /* v2-celestial-wiring: decorative orbital moon per planet (deterministic
   * phase from the planet id; no gameplay, nothing saved). */
  function drawMoon(ctx, pl, time) {
    var mid = SF.Planets.moonSpriteId(pl);
    if (!mid || !(window.SF && SF.Sprites)) return;
    var img = SF.Sprites.get('celestial/moons', mid);
    var ang = time * 0.12 + (hashStr(pl.id) % 628) / 100;
    var mx = pl.x + Math.cos(ang) * 165, my = pl.y + Math.sin(ang) * 165 * 0.62;
    ctx.save();
    ctx.translate(mx, my);
    if (img) {
      ctx.drawImage(img, -22, -22, 44, 44);
    } else {
      // procedural fallback while the sprite loads
      ctx.fillStyle = '#8a8a9a';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(-5, -5, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- planets ---------------- */

  var Planets = {

    list: function (systemId) {
      return SF.PLANETS.filter(function (p) { return p.systemId === systemId; });
    },

    /* v2-celestial-wiring: sprite/biome id lookups (test hooks). A data field
     * on the planet object wins over the curated map, so a future data phase
     * can name biomes without touching this file. */
    planetSpriteId: function (pl) { return (pl && (pl.spriteId || V3_PLANET_SPRITE[pl.id] || V2_PLANET_SPRITE[pl.id])) || null; },
    /* planet-sprites-3: asset kind for a planet's sprite — V3 ids live under
     * assets/sprites/planets/ ('planets'), V2 under assets/sprites/celestial/
     * planets/ (test hook). */
    planetSpriteKind: function (pl) {
      var sid = this.planetSpriteId(pl);
      return (sid && V3_PLANET_IDS.indexOf(sid) >= 0) ? 'planets' : 'celestial/planets';
    },
    /* planet-sprites-3: new worlds / station variants for a system, weight
     * desc (test hooks). */
    v3Worlds: function (systemId) {
      return V3_WORLDS.filter(function (w) { return w.systemId === systemId; })
        .sort(function (a, b) { return b.weight - a.weight; });
    },
    v3Stations: function (systemId) {
      return V3_STATIONS.filter(function (s) { return s.systemId === systemId; })
        .sort(function (a, b) { return b.weight - a.weight; });
    },
    v3PlanetIds: function () { return V3_PLANET_IDS.slice(); },
    v3StationIds: function () { return V3_STATION_IDS.slice(); },
    moonSpriteId: function (pl) { return (pl && V2_MOON_SPRITE[pl.id]) || null; },
    biomeId: function (pl) { return (pl && (pl.biome || V2_BIOME[pl.id])) || null; },

    /* backgrounds-wiring-2: surface vista id lookup (test hook). A data field
     * on the planet object wins over the curated map, so a future data phase
     * can name vistas without touching this file. */
    vistaId: function (pl) { return (pl && (pl.vistaId || V2_SURFACE_VISTA[pl.id])) || null; },

    /* backgrounds-wiring-3: system vista id lookup (test hook). A data field
     * on the planet object wins over the curated map, so a future data phase
     * can name system vistas without touching this file. */
    systemVistaId: function (pl) { return (pl && (pl.systemVistaId || V3_SYSTEM_VISTA[pl.systemId])) || null; },

    /* surface-props-wiring: full list of surface prop sprite ids (test hook). */
    surfacePropIds: function () { return SURFACE_PROP_IDS.slice(); },

    /* surface-props-wiring: resolved prop list for a planet
     * ([{id, cat, role}]) — deterministic, save-neutral (test hook). */
    surfaceProps: function (pl) { return resolveProps(pl); },

    /* surface-props-wiring: last paint stats {expected, sprite, fallback,
     * shipSprite} (test hook). sprite+fallback === expected when the paint
     * is settled; sprite === expected means zero fallbacks. */
    surfaceStats: function () { return _propStats; },

    /* surface-props-wiring: paint the prop canvas (test hook). */
    paintProps: function (cv, pl, attempt, token) { paintSurfaceProps(cv, pl, attempt || 0, token); },

    /* Land: swap the store overlay for the surface view. */
    land: function (pl) {
      SF.Audio.dock();
      SF.Game.dockedAt = pl.name;
      SF.Game.setState('DOCKED');
      SF.Game.hideOverlay('overlay-store');
      // surface-props-wiring: warm the prop sprites before first paint
      if (window.SF && SF.Sprites) SF.Sprites.preload('surface', SURFACE_PROP_IDS);
      this.render(pl);
      SF.Game.showOverlay('overlay-surface');
      if (window.SF && SF.News) SF.News.ambient();
      SF.Save.save();
      SF.HUD.toast('Landed on ' + pl.name + ' — progress saved');
    },

    liftoff: function () {
      SF.Audio.ui();
      SF.Game.hideOverlay('overlay-surface');
      SF.Station.undock();
    },

    render: function (pl) {
      var body = $('surface-body');
      body.innerHTML = '';
      var p = SF.Player;

      // planet art header (v2-celestial-wiring: biome tile behind the gradient)
      var art = document.createElement('div');
      art.className = 'surface-art';
      art.style.position = 'relative';
      art.style.overflow = 'hidden';
      art.style.background =
        'radial-gradient(circle at 50% 35%, ' + pl.color + ' 0%, ' + pl.color + '55 38%, #060a18 72%)';
      // backgrounds-wiring-3: quality gate — the Low tier skips the 2048px
      // vista layers entirely (procedural gradient + biome tile only).
      var vistaHiQ = !(window.SF && SF.FX && SF.FX.getEffective &&
        SF.FX.getEffective() === 'low');
      // backgrounds-wiring-3: system vista layer (vols 5-7), BOTTOM of the
      // surface-art div, behind the planet surface vista at lower opacity.
      var sysVista = vistaHiQ ? this.systemVistaId(pl) : null;
      if (sysVista) {
        var sysImg = document.createElement('img');
        sysImg.src = 'assets/bg/' + sysVista + '.webp';
        sysImg.alt = '';
        sysImg.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.35;';
        art.appendChild(sysImg);
      }
      // backgrounds-wiring-2: planet-surface vista layer (biome tile still
      // inserted on top as the fallback)
      var artVista = vistaHiQ ? this.vistaId(pl) : null;
      if (artVista) {
        var vistaImg = document.createElement('img');
        vistaImg.src = 'assets/bg/' + artVista + '.webp';
        vistaImg.alt = '';
        vistaImg.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.55;';
        art.appendChild(vistaImg);
      }
      var artBiome = this.biomeId(pl);
      if (artBiome) {
        var artImg = document.createElement('img');
        artImg.src = 'assets/sprites/biomes/' + artBiome + '.png';
        artImg.alt = '';
        artImg.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.45;';
        art.appendChild(artImg);
      }
      // surface-props-wiring: prop canvas — above the vista stack, below the
      // text (the text div carries z-index:1). Inline styles only; no css/
      // scope touched. Gives the prop ground band room via min-height.
      art.style.minHeight = '240px';
      var propCv = document.createElement('canvas');
      propCv.className = 'surface-props';
      propCv.setAttribute('data-testid', 'surface-props');
      propCv.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
      art.appendChild(propCv);
      art._propToken = (art._propToken || 0) + 1;
      this.paintProps(propCv, pl, 0, art._propToken);
      // NOTE: never use art.innerHTML += here — it would re-serialize the
      // div and destroy the live prop canvas (wiping its bitmap). Build the
      // text block as a sibling element instead.
      var txt = document.createElement('div');
      txt.style.cssText = 'position:relative;z-index:1';
      txt.innerHTML =
        '<div class="surface-name">\uD83C\uDF0D ' + pl.name.toUpperCase() + '</div>' +
        '<div class="surface-desc">' + pl.desc + '</div>' +
        (pl.faction ? '<div class="surface-desc dim">Held by: <b style="color:' +
          SF.FACTION_BY_ID[pl.faction].color + '">' + SF.FACTION_BY_ID[pl.faction].name +
          '</b></div>' : '<div class="surface-desc dim">Unclaimed territory.</div>');
      art.appendChild(txt);
      body.appendChild(art);

      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'GROUND FACILITIES'; body.appendChild(h);

      var self = this;
      function facRow(label, sub, fn, gated) {
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div><div class="store-name">' + label + '</div>' +
          '<div class="store-desc">' + sub + '</div></div></div>' +
          '<button class="btn store-btn"' + (gated ? ' disabled' : '') + '>ENTER</button>';
        if (!gated) div.querySelector('button').addEventListener('click', fn);
        body.appendChild(div);
        return div;
      }

      if (pl.facilities.indexOf('bar') >= 0)
        facRow('\uD83C\uDF7A GROUND BAR', 'Rumors, dice, and information for sale.',
          function () { SF.Bar.open(pl); });
      if (pl.facilities.indexOf('blackmarket') >= 0) {
        var bmRow = facRow('\uD83D\uDD76 BLACK MARKET', 'Contraband and jobs that never happened.',
          function () { SF.BlackMarket.open(pl.name); });
        bmRow.setAttribute('data-testid', 'facility-blackmarket');
        /* interiors-wiring-3: smuggler's-cove mood on the ground-market row
         * (interiors-wiring-2 section-card pattern; blackmarket_den keeps the
         * primary blackmarket-overlay backdrop). */
        if (window.SF && SF.Interiors) SF.Interiors.applyBackdropTo(bmRow, 'smuggler');
      }
      if (pl.facilities.indexOf('repair') >= 0)
        facRow('\uD83D\uDD27 REPAIR YARD', 'No questions, no paperwork, 20% under station rates.',
          function () { self.repair(pl); });
      if (pl.facilities.indexOf('news') >= 0)
        facRow('\uD83D\uDCF0 NEWS BOARD', 'The galactic wire, fresh from the sector.',
          function () { SF.News.open(); });

      var lf = document.createElement('div');
      lf.className = 'store-row';
      lf.innerHTML = '<div class="store-info"><div><div class="store-name">Local goods</div>' +
        '<div class="store-desc">This world produces: <b>' +
        pl.goods.map(function (g) {
          var gd = SF.CONFIG.trading.goods.filter(function (x) { return x.id === g; })[0];
          return gd ? gd.name : g;
        }).join(', ') + '</b></div></div></div>';
      body.appendChild(lf);
    },

    /* Shady ground repair: 0.8x rate, ignores the karma price penalty. */
    repair: function (pl) {
      var p = SF.Player, eco = SF.CONFIG.economy;
      var missing = p.maxHull() - p.hull;
      if (missing <= 0) { SF.HUD.toast('Hull at 100%.'); return; }
      var cost = Math.ceil(missing * eco.repairPerHp * 0.8);
      if (p.credits < cost) { SF.Audio.deny(); SF.HUD.toast('Not enough credits for the yard.'); return; }
      p.credits -= cost;
      p.heal(missing);
      SF.Audio.buy(); SF.Save.save();
      SF.HUD.toast('Yard patched ' + Math.ceil(missing) + ' hull for ' + fmt(cost) + 'c.');
      this.render(pl);
    },

    /* World-space planet rendering (called from station.drawOne route). */
    drawOne: function (ctx, pl, time) {
      preloadV2(); // v2-celestial-wiring: kick off optimized sprite fetches on first paint
      // v2-celestial-wiring: optimized sprite by body id, procedural fallback otherwise
      // planet-sprites-3: V3 ids resolve under the 'planets' asset kind
      var sprId = Planets.planetSpriteId(pl);
      var sprKind = Planets.planetSpriteKind(pl);
      var img = (window.SF && SF.Sprites && sprId) ? SF.Sprites.get(sprKind, sprId) : null;
      // atmosphere glow (reads behind sprite or procedural body alike)
      var g = ctx.createRadialGradient(pl.x, pl.y, 40, pl.x, pl.y, 78);
      g.addColorStop(0, pl.color);
      g.addColorStop(0.55, pl.color + '66');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, 78, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(pl.x, pl.y);
      if (img) {
        var sz = 148;
        ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      } else {
        // procedural fallback: biome tile clipped into the disc when decoded,
        // else the original gradient + surface bands
        var bId = Planets.biomeId(pl);
        var bimg = (window.SF && SF.Sprites && bId) ? SF.Sprites.get('biomes', bId) : null;
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.clip();
        if (bimg) {
          ctx.drawImage(bimg, -46, -46, 92, 92);
        } else {
          var bg0 = ctx.createRadialGradient(-18, -18, 8, 0, 0, 46);
          bg0.addColorStop(0, pl.color);
          bg0.addColorStop(1, '#0a0d1a');
          ctx.fillStyle = bg0;
          ctx.fillRect(-46, -46, 92, 92);
          // surface bands (original fallback detail)
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 5;
          for (var i = 0; i < 3; i++) {
            var y = -24 + i * 22 + Math.sin(time * 0.4 + i * 2) * 4;
            ctx.beginPath(); ctx.moveTo(-46, y); ctx.quadraticCurveTo(0, y + 8, 46, y); ctx.stroke();
          }
        }
        // spherical shading over the texture
        var sh = ctx.createRadialGradient(-14, -14, 6, 0, 0, 52);
        sh.addColorStop(0, 'rgba(255,255,255,0.10)');
        sh.addColorStop(0.55, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,20,0.55)');
        ctx.fillStyle = sh;
        ctx.fillRect(-46, -46, 92, 92);
        ctx.restore();
      }
      ctx.restore();
      drawMoon(ctx, pl, time); // v2-celestial-wiring: decorative orbital moon
      ctx.fillStyle = pl.color;
      ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(pl.name, pl.x, pl.y - 92);
    }
  };
  SF.Planets = Planets;

  /* interiors-wiring: interior backdrop helpers (test hooks).
   * backdropImg() returns the bottom-layer <img> for a view: absolute,
   * cover-fit, behind content (z-index -1). The caller must make the
   * container a stacking context first (position:relative + z-index 0)
   * so the backdrop sits above the panel background but below content.
   * A plain gradient remains behind the img while it loads (the container
   * keeps its existing background), so a missing file never breaks the view. */
  SF.Interiors = {
    id: function (key) { return V2_INTERIOR[key] || null; },
    backdropImg: function (key, opacity) {
      var id = V2_INTERIOR[key];
      var img = document.createElement('img');
      img.setAttribute('data-interior', id || 'missing:' + key);
      img.alt = '';
      if (id) img.src = 'assets/bg/interiors/' + id + '.webp';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
        'object-fit:cover;opacity:' + (opacity == null ? 0.6 : opacity) +
        ';pointer-events:none;z-index:-1;border-radius:12px;';
      return img;
    },
    /* applyBackdrop: mount the backdrop on the store PANEL (not #store-body:
     * the panel's own opaque background would hide a negative-z child).
     * The panel becomes a stacking context with a translucent background so
     * the img shows through behind all content; every docked view gets a
     * backdrop, so the translucent panel is always intentional. */
    applyBackdrop: function (body, key) {
      var panel = (body.closest) ? body.closest('.panel') : null;
      var host = panel || body;
      /* the panel persists across docks (only #store-body is cleared), so
       * drop the previous view's backdrop first: exactly one per view. */
      var old = host.querySelectorAll('img[data-interior]');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      host.style.position = 'relative';
      host.style.zIndex = '0';
      if (panel) panel.style.background = 'rgba(10,18,38,0.38)';
      host.insertBefore(this.backdropImg(key), host.firstChild);
      return host;
    },
    /* interiors-wiring-2: panel backdrop key per station. The player homebase
     * gets the command-deck scene; everything unmapped keeps the legacy
     * 'hangar' backdrop (graceful fallback — the view never goes blank).
     * HQ stations are NOT resolved here: they return early to SF.HQ.render. */
    stationKey: function (st) {
      st = st || {};
      if (st.kind === 'homebase') return 'homebase';
      return 'hangar';
    },
    /* interiors-wiring-2: applyBackdropTo mounts the backdrop on the given
     * element itself (a section card inside the store panel) instead of
     * climbing to .panel like applyBackdrop does. The element becomes its own
     * stacking context, so the img sits behind its content but above the
     * panel's own backdrop. Previous section backdrops on the element are
     * removed first (the store body re-renders on every buy/sell). */
    applyBackdropTo: function (el, key) {
      if (!el) return null;
      var old = el.querySelectorAll('img[data-interior]');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      el.style.position = 'relative';
      el.style.zIndex = '0';
      el.insertBefore(this.backdropImg(key), el.firstChild);
      return el;
    }
  };

  /* ---------------- interiors-wiring-3: live interior views ----------------
   * The 5 remaining map-only V2_INTERIOR keys get live views here, all inside
   * this file's scope (no other module touched):
   *   chart       -> HQ "STAR CHART" service row (new, in SF.HQ.render below)
   *   observatory -> HQ "OBSERVATORY" service row (new, in SF.HQ.render below)
   *   smuggler    -> surface BLACK MARKET facility row backdrop (the
   *                  interiors-wiring-2 section-card pattern; blackmarket_den
   *                  keeps the primary blackmarket-overlay backdrop)
   *   sanctum     -> SF.Interiors.openSanctum(host, back): dungeon-sanctum
   *                  view; the natural hook is SF.Secrets2._dungeon/_room in
   *                  js/secrets2.js (out of scope) — exact hook line is in
   *                  phases/interiors-wiring-3/REPORT.md
   *   wormhole    -> SF.Interiors.openWormholeLab(host, back): wormhole-lab
   *                  view; the natural hook is the SF.Wormholes transit UI in
   *                  js/main.js (out of scope) — exact hook line in REPORT.md
   * Backdrops go through SF.Interiors.backdropImg (the retry-phase pattern:
   * direct <img> assets/bg/interiors/<id>.webp, gradient behind on miss).
   * Everything here is save-neutral: render mapping only, no save writes,
   * SAVE_VERSION stays v11. */

  /* Sub-view scaffold: full interior view rendered into host — backdrop +
   * title + body built by buildFn + BACK. back() re-renders the caller. */
  function openInteriorView(key, host, title, sub, buildFn, back) {
    host.innerHTML = '';
    var root = document.createElement('div');
    root.className = 'interior-view';
    root.setAttribute('data-interior-view', key);
    root.style.cssText = 'position:relative;z-index:0;min-height:420px;' +
      'border:1px solid #2a3a5f;border-radius:12px;padding:14px;overflow:hidden;';
    root.appendChild(SF.Interiors.backdropImg(key, 0.55));
    var head = document.createElement('div');
    head.style.position = 'relative';
    head.innerHTML = '<div class="store-head">' + title + '</div>' +
      (sub ? '<div class="dim" style="margin-bottom:8px">' + sub + '</div>' : '');
    root.appendChild(head);
    var mid = document.createElement('div');
    mid.style.position = 'relative';
    root.appendChild(mid);
    buildFn(mid);
    if (back) {
      var brow = document.createElement('div');
      brow.style.cssText = 'position:relative;margin-top:12px;';
      var bb = document.createElement('button');
      bb.className = 'btn store-btn';
      bb.setAttribute('data-testid', 'interior-back');
      bb.textContent = '\u2190 BACK';
      bb.addEventListener('click', function () { SF.Audio.ui(); back(); });
      brow.appendChild(bb);
      root.appendChild(brow);
    }
    host.appendChild(root);
    return root;
  }

  function hqServiceRow(label, sub, testid, fn) {
    var div = document.createElement('div');
    div.className = 'store-row';
    div.setAttribute('data-testid', testid);
    div.innerHTML = '<div class="store-info"><div><div class="store-name">' + label + '</div>' +
      '<div class="store-desc">' + sub + '</div></div></div>' +
      '<button class="btn store-btn">ENTER</button>';
    div.querySelector('button').addEventListener('click', function () { SF.Audio.ui(); fn(); });
    return div;
  }

  /* Chart room: surveyed-system intel for the capital's nav vault. */
  function openChartView(host, hq) {
    return openInteriorView('chart', host, '\uD83D\uDDFA STAR CHART',
      'Nav vault \u2014 ' + hq.name,
      function (mid) {
        SF.SYSTEMS.forEach(function (s) {
          var known = SF.Game.discovered.indexOf(s.id) >= 0;
          var pls = known ? SF.Planets.list(s.id) : [];
          var row = document.createElement('div');
          row.className = 'store-row';
          row.setAttribute('data-sys', s.id);
          row.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name" style="color:' + (known ? s.color : '#66707f') + '">' +
            (known ? s.name.toUpperCase() : '??? UNCHARTED') + '</div>' +
            '<div class="store-desc">' + (known ? pls.length + ' worlds charted' :
              'No survey data \u2014 fly there to chart it.') +
            '</div></div></div>' +
            '<button class="btn store-btn"' + (known ? '' : ' disabled') + '>INTEL</button>';
          var det = document.createElement('div');
          det.className = 'store-desc';
          det.style.cssText = 'position:relative;display:none;margin:-4px 0 8px;padding:8px;' +
            'border:1px solid #2a3a5f;border-radius:8px;background:rgba(6,10,24,0.55);';
          det.setAttribute('data-testid', 'chart-detail-' + s.id);
          if (known) {
            row.querySelector('button').addEventListener('click', function () {
              SF.Audio.ui();
              var show = det.style.display === 'none';
              det.style.display = show ? 'block' : 'none';
              if (show && !det._filled) {
                det._filled = true;
                det.innerHTML = pls.map(function (p) {
                  return '<div>\u25B8 <b>' + p.name + '</b> <span class="dim">' +
                    (p.facilities || []).join(' \u00B7 ') + '</span></div>';
                }).join('') || '<span class="dim">No landable worlds.</span>';
              }
            });
          }
          mid.appendChild(row);
          mid.appendChild(det);
        });
      },
      function () { host.innerHTML = ''; SF.HQ.render(host, hq); });
  }
  SF.Interiors.openChart = openChartView;

  /* Observatory: the capital's observation deck, trained on the live system. */
  function openObservatoryView(host, hq) {
    var sysId = SF.Game.systemId;
    var vista = null;
    try { vista = SF.Planets.systemVistaId({ systemId: sysId }); } catch (e) { vista = null; }
    var s = SF.SYSTEMS.filter(function (x) { return x.id === sysId; })[0] ||
      { name: sysId, color: '#9fb4d8' };
    return openInteriorView('observatory', host, '\uD83D\uDD2D OBSERVATORY',
      'Observation deck \u2014 ' + hq.name,
      function (mid) {
        if (vista) {
          var img = document.createElement('img');
          img.src = 'assets/bg/' + vista + '.webp';
          img.alt = '';
          img.setAttribute('data-testid', 'observatory-vista');
          img.style.cssText = 'position:relative;width:100%;border-radius:8px;margin-bottom:8px;';
          mid.appendChild(img);
        }
        var d = document.createElement('div');
        d.className = 'dim';
        d.style.cssText = 'position:relative;margin-bottom:8px;';
        d.innerHTML = 'Long scopes trained on <b style="color:' + s.color + '">' +
          String(s.name).toUpperCase() + '</b> \u2014 ' +
          SF.Planets.list(sysId).length + ' worlds in view.';
        mid.appendChild(d);
        var res = document.createElement('div');
        res.className = 'store-desc';
        res.style.cssText = 'position:relative;margin-bottom:8px;min-height:20px;';
        res.setAttribute('data-testid', 'observatory-scan');
        mid.appendChild(res);
        var sb = document.createElement('button');
        sb.className = 'btn store-btn';
        sb.style.position = 'relative';
        sb.setAttribute('data-testid', 'observatory-scan-btn');
        sb.textContent = 'SCAN THE VOID';
        sb.addEventListener('click', function () {
          SF.Audio.ui();
          /* deterministic flavor scan (seeded by system id — save-neutral) */
          var h = 0, str = 'scan:' + sysId, i;
          for (i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
          var n = 2 + (Math.abs(h) % 4);
          res.textContent = 'Deep scan: ' + n + ' contacts on the long scope \u2014 ' +
            (n > 3 ? 'a convoy burning spinward.' : 'drifting hulks, cold and quiet.');
        });
        mid.appendChild(sb);
      },
      function () { host.innerHTML = ''; SF.HQ.render(host, hq); });
  }
  SF.Interiors.openObservatory = openObservatoryView;

  /* Sanctum: the Hollow Cathedral's sanctum status. Dungeons live in
   * flight-space (secrets2.js), not on planets/HQs, so this view has no
   * planets.js entry point by design — the natural hook is
   * SF.Secrets2._dungeon/_room in js/secrets2.js (out of scope); the exact
   * hook line is in phases/interiors-wiring-3/REPORT.md. */
  SF.Interiors.openSanctum = function (host, back) {
    var dg = null, wing = null;
    try {
      var ss = (window.SF && SF.Player) ? SF.Player.secretsState : null;
      if (ss) { dg = ss.dungeon || null; wing = ss.wing || null; }
    } catch (e) { dg = null; wing = null; }
    var status = !dg ? 'No cathedral telemetry \u2014 the void keeps its own counsel.' :
      dg.cleared ? 'The Warden is down. The sanctum hangs quiet.' :
      dg.room > 0 ? 'Breached to room ' + dg.room + ' of 4 \u2014 the sanctum waits below.' :
      'Unbreached. Something vast and patient breathes in the dark.';
    var wingStatus = !wing ? '' :
      wing.cleared ? ' Sanctum wing cleared.' :
      wing.room > 0 ? ' Sanctum wing: room ' + wing.room + '.' : '';
    return openInteriorView('sanctum', host, '\u25C8 SANCTUM',
      'The Hollow Cathedral \u2014 sealed depths',
      function (mid) {
        var d = document.createElement('div');
        d.className = 'store-desc';
        d.style.cssText = 'position:relative;margin-bottom:8px;';
        d.setAttribute('data-testid', 'sanctum-status');
        d.textContent = status + wingStatus;
        mid.appendChild(d);
        var rooms = ['Vestibule', 'Reactor Nave', 'Reliquary', "Warden's Sanctum"];
        rooms.forEach(function (r, i) {
          var n = i + 1;
          var reached = !!(dg && (dg.cleared || dg.room >= n));
          var row = document.createElement('div');
          row.className = 'store-row';
          row.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name" style="color:' + (reached ? '#ffd24a' : '#66707f') + '">\u2620 ' +
            r.toUpperCase() + '</div>' +
            '<div class="store-desc">' + (dg && dg.cleared ? 'Cleared.' :
              reached ? 'Breached.' : 'Sealed.') + '</div></div></div>';
          mid.appendChild(row);
        });
      },
      back || null);
  };

  /* Wormhole lab: unstable-signature telemetry for the current system. The
   * transit itself is flight UI (main.js SF.Wormholes, out of scope); the
   * exact hook line is in phases/interiors-wiring-3/REPORT.md. */
  SF.Interiors.openWormholeLab = function (host, back) {
    var t = null;
    try {
      t = (window.SF && SF.Wormholes && SF.Wormholes.testState) ? SF.Wormholes.testState() : null;
    } catch (e) { t = null; }
    var sysName = ((SF.SYSTEMS.filter(function (x) { return x.id === SF.Game.systemId; })[0] || {}).name) ||
      SF.Game.systemId;
    return openInteriorView('wormhole', host, '\uD83C\uDF00 WORMHOLE LAB',
      'Unstable-signature research \u2014 ' + sysName,
      function (mid) {
        var d = document.createElement('div');
        d.className = 'store-desc';
        d.style.cssText = 'position:relative;margin-bottom:8px;';
        d.setAttribute('data-testid', 'wormhole-status');
        var n = t ? t.count : 0;
        d.textContent = n === 0 ? 'No unstable signatures on the scopes. The lab idles.' :
          n + ' unstable signature' + (n > 1 ? 's' : '') + ' tracked in-system.';
        mid.appendChild(d);
        (t ? t.holes : []).forEach(function (h, i) {
          var row = document.createElement('div');
          row.className = 'store-row';
          row.setAttribute('data-hole', i);
          row.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name" style="color:#c9a7ff">SIGNATURE ' + (i + 1) + '</div>' +
            '<div class="store-desc">Uses: ' + h.uses + ' of 3 \u2014 ' +
            (h.uses >= 3 ? 'collapsed.' : 'transit viable.') + '</div></div></div>';
          mid.appendChild(row);
        });
        var note = document.createElement('div');
        note.className = 'dim';
        note.style.cssText = 'position:relative;margin-top:8px;';
        note.textContent = 'Field note: fly into a swirl to ride it. Destination unknown \u2014 ' +
          'the lab only tracks, never steers.';
        mid.appendChild(note);
      },
      back || null);
  };

  /* ---------------- medbay-clinic: dock medical bay clinic ----------------
   * The interiors-wiring-3 phase deferred the medbay (dock_medical_bay was
   * map-only: "no clinic UI exists", REPORT.md "Notes for the next phase").
   * This phase builds the clinic service, entered from a MEDICAL BAY row in
   * SF.HQ.render's FACTION SERVICES section (dock fiction — the ground
   * REPAIR YARD keeps its own shady rate; never wired there). The backdrop
   * goes through the V2_INTERIOR retry pattern (direct <img>
   * assets/bg/interiors/dock_medical_bay.webp via SF.Interiors.backdropImg;
   * a gradient sits behind on miss, so a missing file never breaks the view).
   * Services:
   *   1. Hull restoration — full heal, price scales with missing hull:
   *      ceil(missing * eco.repairPerHp * MEDBAY_REPAIR_MUL * pm).
   *   2. Crew treatment — hooks the crew-morale system (crew.js untouched):
   *      members at morale <= 30 read as combat fatigue (unfit for duty;
   *      their perk factor is already ~0.7x at that morale); fee 250c x level
   *      restores morale to 85. No new flags, no crew.js changes.
   *   3. Stimpacks — consumable in SF.Player.inventory['stimpack'], persisted
   *      by the existing inventory blob (ship.js serialize() copies it), so
   *      save-neutral: SAVE_VERSION stays v11, no migrate function.
   *      Injecting consumes one and starts a 60s stim; SF.Medbay.stimRegenMul()
   *      returns 1.25 while active (test hooks: stimActive, stimTimeLeftMs).
   *      Applying the multiplier in the flight loop needs a ship.js-scope
   *      phase — the exact hook line is in this phase's REPORT.md ("Notes for
   *      the next phase"). Stim state is runtime-only (never serialized).
   * Test hooks: SF.Medbay.{healMissing,healPrice,buyHeal,patients,treatFee,
   *   treatPatient,stimCount,stimPrice,buyStimpack,injectStimpack,stimActive,
   *   stimRegenMul,stimTimeLeftMs,resetStim}. */

  var MEDBAY_REPAIR_MUL = 1.2;   // clinic premium over the yard rate
  var MEDBAY_STIM_PRICE = 750;   // credits per stimpack
  var MEDBAY_STIM_MS = 60000;    // stim duration
  var MEDBAY_STIM_MUL = 1.25;    // +25% regen while active
  var MEDBAY_TREAT_BASE = 250;   // treatment fee x member level
  var MEDBAY_FATIGUE = 30;       // morale at/below this = unfit for duty
  var MEDBAY_TREATED = 85;       // morale after treatment
  var MEDBAY_STIM_KEY = 'stimpack';

  var _stim = { until: 0 }; // runtime-only stim state; never serialized

  /* HQ price multiplier, defensively: SF.HQ is defined later in this file,
   * so only call it at runtime, never at parse time. */
  function medbayPm(hq) {
    try {
      if (hq && hq.factionId && window.SF && SF.HQ && SF.HQ.factionMul)
        return SF.HQ.factionMul(hq.factionId);
    } catch (e) {}
    return 1;
  }

  function medbayInv() {
    var p = SF.Player;
    if (!p || !p.inventory) return {};
    return p.inventory;
  }

  var Medbay = {

    /* hull points missing right now (never negative) */
    healMissing: function () {
      var p = SF.Player;
      if (!p || typeof p.maxHull !== 'function') return 0;
      return Math.max(0, Math.floor(p.maxHull() - p.hull));
    },

    /* full-heal price for the current damage at price multiplier pm */
    healPrice: function (pm) {
      var eco = SF.CONFIG.economy;
      return Math.ceil(this.healMissing() * eco.repairPerHp * MEDBAY_REPAIR_MUL * (pm || 1));
    },

    buyHeal: function (pm) {
      var p = SF.Player, missing = this.healMissing();
      if (missing <= 0) { SF.HUD.toast('Hull at 100%.'); return false; }
      var cost = this.healPrice(pm);
      if (p.credits < cost) { SF.Audio.deny(); SF.HUD.toast('Not enough credits for the clinic.'); return false; }
      p.credits -= cost;
      if (typeof p.heal === 'function') p.heal(missing); else p.hull = p.maxHull();
      SF.Audio.buy(); SF.Save.save();
      SF.HUD.toast('Nanite bath sealed ' + fmt(missing) + ' hull for ' + fmt(cost) + 'c.');
      return true;
    },

    /* crew at/below the fatigue line — the clinic's patients */
    patients: function () {
      var out = [];
      try {
        var roster = (window.SF && SF.Player && typeof SF.Player.crewList === 'function') ?
          SF.Player.crewList() : [];
        for (var i = 0; i < roster.length; i++) {
          var m = SF.Crew.ensure(roster[i]);
          if (m.morale <= MEDBAY_FATIGUE) out.push(m);
        }
      } catch (e) {}
      return out;
    },

    treatFee: function (m) { return Math.ceil(MEDBAY_TREAT_BASE * ((m && m.level) || 1)); },

    treatPatient: function (m) {
      var p = SF.Player, fee = this.treatFee(m);
      if (p.credits < fee) { SF.Audio.deny(); SF.HUD.toast('Not enough credits for treatment.'); return false; }
      p.credits -= fee;
      m.morale = MEDBAY_TREATED;
      SF.Crew.ensure(m);
      SF.Audio.buy(); SF.Save.save();
      SF.HUD.toast(m.name + ' cleared for duty (morale ' + MEDBAY_TREATED + ').');
      return true;
    },

    stimCount: function () {
      var n = medbayInv()[MEDBAY_STIM_KEY];
      return Math.max(0, Math.floor(n || 0));
    },

    stimPrice: function (pm) { return Math.ceil(MEDBAY_STIM_PRICE * (pm || 1)); },

    buyStimpack: function (pm) {
      var p = SF.Player, cost = this.stimPrice(pm);
      if (p.credits < cost) { SF.Audio.deny(); SF.HUD.toast('Not enough credits for a stimpack.'); return false; }
      p.credits -= cost;
      var inv = medbayInv();
      inv[MEDBAY_STIM_KEY] = this.stimCount() + 1;
      SF.Audio.buy(); SF.Save.save();
      SF.HUD.toast('Stimpack stocked (' + inv[MEDBAY_STIM_KEY] + ' in inventory).');
      return true;
    },

    injectStimpack: function () {
      if (this.stimCount() <= 0) { SF.Audio.deny(); SF.HUD.toast('No stimpacks in inventory.'); return false; }
      if (this.stimActive()) { SF.Audio.deny(); SF.HUD.toast('Stim already active.'); return false; }
      var inv = medbayInv();
      inv[MEDBAY_STIM_KEY] = this.stimCount() - 1;
      _stim.until = Date.now() + MEDBAY_STIM_MS;
      SF.Audio.buy(); SF.Save.save();
      SF.HUD.toast('Stimpack injected \u2014 +25% hull regen for 60s.');
      return true;
    },

    stimActive: function () { return Date.now() < _stim.until; },
    stimRegenMul: function () { return this.stimActive() ? MEDBAY_STIM_MUL : 1; },
    stimTimeLeftMs: function () { return Math.max(0, _stim.until - Date.now()); },
    resetStim: function () { _stim.until = 0; } // test hook
  };
  SF.Medbay = Medbay;

  /* Medbay clinic view: entered from the HQ MEDICAL BAY service row. The
   * view re-renders itself after every purchase (openInteriorView clears the
   * host and rebuilds, backdrop included). */
  function openMedbayView(host, hq) {
    var pm = medbayPm(hq);
    var hqName = (hq && hq.name) || 'station';
    function render() {
      openInteriorView('medbay', host, '\u2695 MEDICAL BAY',
        'Dock clinic \u2014 ' + hqName,
        function (mid) {
          var p = SF.Player;
          var stat = document.createElement('div');
          stat.className = 'dim';
          stat.style.cssText = 'position:relative;margin-bottom:8px;';
          stat.setAttribute('data-testid', 'medbay-status');
          stat.innerHTML = 'Hull <b>' + fmt(Math.floor(p.hull)) + '</b>/' + fmt(p.maxHull()) +
            ' \u00B7 <b>' + fmt(p.credits) + 'c</b>' +
            (Medbay.stimActive() ?
              ' \u00B7 <b style="color:#7dff9a">STIM ' + Math.ceil(Medbay.stimTimeLeftMs() / 1000) + 's</b>' : '');
          mid.appendChild(stat);

          /* ---- 1. hull restoration ---- */
          var h1 = document.createElement('div'); h1.className = 'store-head';
          h1.textContent = 'HULL RESTORATION'; mid.appendChild(h1);
          var missing = Medbay.healMissing(), cost = Medbay.healPrice(pm);
          var hrow = document.createElement('div');
          hrow.className = 'store-row';
          hrow.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name">Nanite hull bath</div>' +
            '<div class="store-desc">' + (missing <= 0 ? 'Hull at 100% \u2014 nothing to seal.' :
              'Seal ' + fmt(missing) + ' missing hull.') + '</div></div></div>' +
            '<button class="btn store-btn" data-testid="medbay-heal-btn"' +
            (missing <= 0 || p.credits < cost ? ' disabled' : '') + '>' +
            (missing <= 0 ? 'FULL' : 'HEAL \u00B7 ' + fmt(cost) + 'c') + '</button>';
          if (missing > 0 && p.credits >= cost) {
            hrow.querySelector('button').addEventListener('click', function () {
              if (Medbay.buyHeal(pm)) render();
            });
          }
          mid.appendChild(hrow);

          /* ---- 2. crew treatment ---- */
          var h2 = document.createElement('div'); h2.className = 'store-head';
          h2.textContent = 'CREW TREATMENT'; mid.appendChild(h2);
          var pats = Medbay.patients();
          if (!pats.length) {
            var ok = document.createElement('div');
            ok.className = 'store-desc';
            ok.style.position = 'relative';
            ok.setAttribute('data-testid', 'medbay-no-patients');
            ok.textContent = 'All crew fit for duty.';
            mid.appendChild(ok);
          }
          pats.forEach(function (m, i) {
            var fee = Medbay.treatFee(m);
            var moodLbl = '';
            try { moodLbl = SF.Crew.mood(m).label; } catch (e) { moodLbl = ''; }
            var row = document.createElement('div');
            row.className = 'store-row';
            row.setAttribute('data-testid', 'medbay-patient-' + i);
            row.innerHTML = '<div class="store-info"><div>' +
              '<div class="store-name" style="color:#ff9a7d">' + m.name +
              ' <span class="dim">\u2014 combat fatigue</span></div>' +
              '<div class="store-desc">' + SF.Crew.roleName(m.role) + ' \u00B7 morale ' +
              Math.round(m.morale) + '/100' + (moodLbl ? ' \u00B7 ' + moodLbl : '') + '</div></div></div>' +
              '<button class="btn store-btn" data-testid="medbay-treat-btn"' +
              (p.credits < fee ? ' disabled' : '') + '>TREAT \u00B7 ' + fmt(fee) + 'c</button>';
            if (p.credits >= fee) {
              row.querySelector('button').addEventListener('click', function () {
                if (Medbay.treatPatient(m)) render();
              });
            }
            mid.appendChild(row);
          });

          /* ---- 3. stimpacks ---- */
          var h3 = document.createElement('div'); h3.className = 'store-head';
          h3.textContent = 'STIMPACKS'; mid.appendChild(h3);
          var n = Medbay.stimCount(), sp = Medbay.stimPrice(pm);
          var srow = document.createElement('div');
          srow.className = 'store-row';
          srow.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name">Combat stimpack <span class="dim">\u00D7' + n + ' in inventory</span></div>' +
            '<div class="store-desc">Inject: +25% hull regen for 60s. Stacks in ship inventory.</div></div></div>' +
            '<button class="btn store-btn" data-testid="medbay-buy-stim"' +
            (p.credits < sp ? ' disabled' : '') + '>BUY \u00B7 ' + fmt(sp) + 'c</button>';
          if (p.credits >= sp) {
            srow.querySelector('button').addEventListener('click', function () {
              if (Medbay.buyStimpack(pm)) render();
            });
          }
          mid.appendChild(srow);
          var irow = document.createElement('div');
          irow.className = 'store-row';
          irow.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name">Inject stimpack</div>' +
            '<div class="store-desc">' + (Medbay.stimActive() ?
              'Stim active \u2014 ' + Math.ceil(Medbay.stimTimeLeftMs() / 1000) + 's remaining.' :
              'Consumes one stimpack from inventory.') + '</div></div></div>' +
            '<button class="btn store-btn" data-testid="medbay-inject-stim"' +
            (n <= 0 || Medbay.stimActive() ? ' disabled' : '') + '>INJECT</button>';
          if (n > 0 && !Medbay.stimActive()) {
            irow.querySelector('button').addEventListener('click', function () {
              if (Medbay.injectStimpack()) render();
            });
          }
          mid.appendChild(irow);
        },
        function () { host.innerHTML = ''; SF.HQ.render(host, hq); });
    }
    render();
  }
  SF.Interiors.openMedbay = openMedbayView;

  /* ---------------- faction HQs ---------------- */

  var HQ = {

    list: function (systemId) {
      return SF.FACTION_HQ.filter(function (h) { return h.systemId === systemId; });
    },

    factionMul: function (fid) {
      // price at an HQ = faction-tuned: friendly standing helps, hostile hurts
      var v = (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0;
      if (v >= 50) return 0.90;
      if (v >= 25) return 0.95;
      if (v <= -25) return 1.25;
      return 1.0;
    },

    /* HQ store section, called from SF.Station.render when docked at an HQ. */
    render: function (body, hq) {
      // interiors-wiring: faction HQ backdrop on the store panel
      // interiors-wiring-2: the compact/ember capitals get their purpose-built
      // embassy scenes (name-matched: embassy_aegis/Aegis Citadel,
      // embassy_ashen/Ashen Throne); drifters keep hq_drifters. A missing
      // embassy id degrades to the faction key (the hq_* rooms stay mapped).
      if (window.SF && SF.Interiors) {
        var ekey = hq.factionId === 'compact' ? 'embassy_aegis' :
                   hq.factionId === 'ember' ? 'embassy_ashen' : null;
        SF.Interiors.applyBackdrop(body, (ekey && SF.Interiors.id(ekey)) || hq.factionId);
      }
      var p = SF.Player, self = this;
      var fid = hq.factionId;
      var f = SF.FACTION_BY_ID[fid];
      var pm = this.factionMul(fid);
      function pr(base) { return Math.ceil(base * pm); }

      var intro = document.createElement('div');
      intro.className = 'dim'; intro.style.marginBottom = '6px';
      intro.innerHTML = hq.blurb + '<br>Standing with <b style="color:' + f.color + '">' + f.name +
        '</b>: ' + SF.Factions.standing(fid) + ' (' + SF.Factions.stance(fid) + ')' +
        (pm !== 1 ? ' · prices \u00D7' + pm.toFixed(2) : '');
      body.appendChild(intro);

      // ---- requisition: HQ-exclusive inventory ----
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = '\u2694 REQUISITION — ' + f.short; body.appendChild(h);
      hq.inventory.forEach(function (id) {
        var def = SF.WEAPON_BY_ID[id] || SF.MOD_BY_ID[id] || SF.PART_BY_ID[id];
        if (!def) return;
        var gated = SF.Factions.standing(fid) < 25;
        var div = document.createElement('div');
        div.className = 'store-row';
        var dot = '<span class="tier-dot" style="background:' + SF.TIERS[def.tier] + '"></span>';
        var owned = def.kind === 'component' ? false :
          (SF.WEAPON_BY_ID[id] ? !!p.weaponEntry(id) :
           (SF.PART_BY_ID[id] ? (p.partInventory[id] || 0) > 0 : false));
        div.innerHTML = '<div class="store-info">' + dot +
          '<div><div class="store-name">' + def.name +
          (gated ? ' <span class="dim">(requires ' + f.short + ' standing 25)</span>' : '') + '</div>' +
          '<div class="store-desc">' + def.desc + '</div></div></div>' +
          '<button class="btn store-btn"' + (gated || owned || p.credits < pr(def.price) ? ' disabled' : '') + '>' +
          (owned ? 'OWNED' : 'BUY \u00B7 ' + fmt(pr(def.price)) + 'c') + '</button>';
        if (!gated && !owned && p.credits >= pr(def.price)) {
          div.querySelector('button').addEventListener('click', function () {
            p.credits -= pr(def.price);
            if (SF.WEAPON_BY_ID[id]) p.addWeapon(id);
            else if (SF.PART_BY_ID[id]) p.addPart(id, 1);
            else if (SF.MOD_BY_ID[id]) { p.modsInv = p.modsInv || {}; p.modsInv[id] = (p.modsInv[id] || 0) + 1; }
            SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore();
            SF.HUD.toast(def.name + ' requisitioned.');
          });
        }
        body.appendChild(div);
      });

      // ---- faction stock: curated regular inventory at the faction price ----
      var h2 = document.createElement('div'); h2.className = 'store-head';
      h2.textContent = 'FACTION STOCK'; body.appendChild(h2);
      hq.stock.forEach(function (id) {
        var def = SF.WEAPON_BY_ID[id] || SF.PART_BY_ID[id];
        if (!def) return;
        var owned = SF.WEAPON_BY_ID[id] ? !!p.weaponEntry(id) : ((p.partInventory[id] || 0) > 0);
        var div = document.createElement('div');
        div.className = 'store-row';
        var dot2 = '<span class="tier-dot" style="background:' + SF.TIERS[def.tier] + '"></span>';
        div.innerHTML = '<div class="store-info">' + dot2 +
          '<div><div class="store-name">' + def.name + '</div>' +
          '<div class="store-desc">' + def.desc + '</div></div></div>' +
          '<button class="btn store-btn"' + (owned || p.credits < pr(def.price) ? ' disabled' : '') + '>' +
          (owned ? 'OWNED' : 'BUY \u00B7 ' + fmt(pr(def.price)) + 'c') + '</button>';
        if (!owned && p.credits >= pr(def.price)) {
          div.querySelector('button').addEventListener('click', function () {
            p.credits -= pr(def.price);
            if (SF.WEAPON_BY_ID[id]) p.addWeapon(id); else p.addPart(id, 1);
            SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore();
          });
        }
        body.appendChild(div);
      });

      // ---- faction services ----
      var h3 = document.createElement('div'); h3.className = 'store-head';
      h3.textContent = 'FACTION SERVICES'; body.appendChild(h3);
      var tcost = 1000;
      var tdiv = document.createElement('div');
      tdiv.className = 'store-row';
      tdiv.innerHTML = '<div class="store-info"><div><div class="store-name">Pay tribute</div>' +
        '<div class="store-desc">A donation to the cause. +' + 5 + ' ' + f.short +
        ' standing, +1 karma.</div></div></div>' +
        '<button class="btn store-btn"' + (p.credits < tcost ? ' disabled' : '') + '>GIVE ' + fmt(tcost) + 'c</button>';
      if (p.credits >= tcost) tdiv.querySelector('button').addEventListener('click', function () {
        p.credits -= tcost;
        SF.Factions.shift(fid, 5);
        SF.Factions.shiftKarma(1);
        SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore();
        SF.HUD.toast(f.name + ' appreciates your loyalty.');
      });
      body.appendChild(tdiv);

      /* interiors-wiring-3: chart room + observatory (live views for the
       * chart/observatory V2_INTERIOR keys). Read-only intel services —
       * save-neutral. */
      body.appendChild(hqServiceRow('\uD83D\uDDFA STAR CHART',
        'The capital\u2019s nav vault \u2014 surveyed systems and world intel.',
        'hq-service-chart',
        function () { openChartView(body, hq); }));
      body.appendChild(hqServiceRow('\uD83D\uDD2D OBSERVATORY',
        'Observation deck \u2014 long scopes on the current system.',
        'hq-service-observatory',
        function () { openObservatoryView(body, hq); }));

      /* medbay-clinic: dock medical bay (deferred by interiors-wiring-3).
       * Dock fiction — the ground REPAIR YARD keeps its own shady rate. */
      body.appendChild(hqServiceRow('\u2695 MEDICAL BAY',
        'Hull restoration, crew treatment, stimpacks.',
        'hq-service-medbay',
        function () { openMedbayView(body, hq); }));

      if (hq.bm) {
        var bdiv = document.createElement('div');
        bdiv.className = 'store-row';
        bdiv.innerHTML = '<div class="store-info"><div><div class="store-name">\uD83D\uDD76 Back-room market</div>' +
          '<div class="store-desc">The faction looks the other way. For a friend.</div></div></div>' +
          '<button class="btn store-btn">ENTER</button>';
        bdiv.querySelector('button').addEventListener('click', function () {
          SF.BlackMarket.open(hq.name);
        });
        body.appendChild(bdiv);
      }
    },

    drawOne: function (ctx, hq, time) {
      var f = SF.FACTION_BY_ID[hq.factionId];
      // station-sprites-wiring: hand-drawn HQ art when decoded, procedural fallback otherwise
      var img = (window.SF && SF.Sprites) ? SF.Sprites.get('stations', hq.id) : null;
      ctx.save();
      ctx.translate(hq.x, hq.y);
      if (img) {
        var sz = 165;
        ctx.rotate(time * 0.1); // keeps the old slow spin
        ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
        ctx.rotate(-time * 0.1);
      } else {
        ctx.rotate(time * 0.1);
        ctx.strokeStyle = f.color; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, 54, 0, Math.PI * 2); ctx.stroke();
        // bastion spokes
        ctx.strokeStyle = f.color + '88'; ctx.lineWidth = 3;
        for (var i = 0; i < 6; i++) {
          var a = i * Math.PI / 3;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
          ctx.lineTo(Math.cos(a) * 54, Math.sin(a) * 54); ctx.stroke();
        }
        ctx.rotate(-time * 0.1);
        ctx.fillStyle = '#10141f';
        ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = f.color;
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(hq.name.toUpperCase(), hq.x, hq.y - 70);
    }
  };
  SF.HQ = HQ;
})();

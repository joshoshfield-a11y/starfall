/* STARFALL Phase 1 — starmap.js
 * DOM overlay star map: 3 systems, current highlighted, undiscovered shown as ???.
 * Fast travel costs 50 credits; arriving at an undiscovered system discovers it.
 */
window.SF = window.SF || {};

SF.Starmap = (function () {
  var POS = { solace: { x: 22, y: 55 }, drift: { x: 52, y: 30 }, ember: { x: 78, y: 62 } };

  function render() {
    var wrap = document.getElementById('starmap-systems');
    wrap.innerHTML = '';
    var g = SF.Game;
    SF.SYSTEMS.forEach(function (s) {
      var known = g.discovered.indexOf(s.id) >= 0;
      var cur = g.systemId === s.id;
      var node = document.createElement('button');
      node.className = 'sys-node' + (cur ? ' current' : '') + (known ? '' : ' unknown');
      node.dataset.sys = s.id; // starmap-hazards: stable selector for tests
      node.style.left = POS[s.id].x + '%';
      node.style.top = POS[s.id].y + '%';
      node.innerHTML =
        '<span class="sys-dot" style="background:' + (known ? s.color : '#555') + '"></span>' +
        '<span class="sys-name">' + (known ? s.name : '???') + '</span>' +
        (cur ? '<span class="sys-you">YOU ARE HERE</span>' : '');
      if (!cur) {
        node.addEventListener('click', function () { tryTravel(s.id); });
      } else {
        node.disabled = true;
      }
      wrap.appendChild(node);
    });
    var info = document.getElementById('starmap-info');
    info.textContent = 'Fast travel: ' + SF.CONFIG.economy.travelCost + ' credits. ' +
      'Undiscovered systems are revealed on arrival.';
    /* open-space-1: in deep space the map says so — and the way back is
     * either flying into a region cell or jumping from here. */
    try {
      if (window.SF && SF.Space && SF.Space.deepSpace())
        info.textContent += ' You are in deep space — fly to a region or jump.';
    } catch (e) {}
  }

  function tryTravel(id) {
    var g = SF.Game, cost = SF.CONFIG.economy.travelCost;
    if (SF.Player.credits < cost) {
      SF.Audio.deny();
      SF.HUD.toast('Need ' + cost + ' credits to jump');
      return;
    }
    SF.Player.credits -= cost;
    SF.Audio.jump();
    g.travelTo(id);
    SF.Starmap.close();
  }

  return {
    open: function () {
      render();
      document.getElementById('overlay-starmap').classList.remove('hidden');
      SF.Audio.ui();
    },
    close: function () {
      document.getElementById('overlay-starmap').classList.add('hidden');
      SF.Audio.ui();
      if (SF.Game.state === 'STARMAP') SF.Game.setState('PLAYING');
    },
    render: render
  };
})();

/* ================= starmap-hazards phase (2026-10-21) =================
 * SF.Hazards: travel hazards on starmap lanes. Runtime-only, regenerated per
 * session from a deterministic daily seed; save-neutral (stays v11).
 *
 * - Radiation Storms: 2-3 drifting zones rendered as animated hazard rings on
 *   the starmap overlay. A jump whose route crosses a storm applies transit
 *   damage (shield -30 per storm) on arrival. Storms drift slowly while the
 *   map is open; what you see is what you fly through (WYSIWYG).
 * - Pirate Blockades: markers on lanes to rich systems (Ember). Flying
 *   through one triggers an ambush wave on arrival; a triggered blockade
 *   stays clear for 5 travel-days (every jump = 1 travel day).
 * - Patrol Interdictions: when any faction is hostile to you (at war) or
 *   SF.Blackmarket.heat is set (wanted), a jump has a 30% chance of being
 *   interdicted — a hostile patrol ambush spawns on arrival.
 *
 * Hooks (additive, no refactor of the starmap.js closure above):
 * - wraps SF.Game.travelTo (deferred until main.js loads) for route checks
 *   and arrival effects,
 * - wraps SF.Starmap.open/close for hazard-marker rendering + storm drift.
 */
window.SF = window.SF || {};

SF.Hazards = (function () {
  'use strict';
  var SF = window.SF;

  /* ---------------- deterministic daily PRNG ---------------- */
  function hashStr(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function todayStr() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* map node positions in % (mirror of the starmap.js closure's POS above) */
  var POS = { solace: { x: 22, y: 55 }, drift: { x: 52, y: 30 }, ember: { x: 78, y: 62 } };
  var RICH = ['ember'];
  var STORM_DMG = 30;           // shield damage per crossed storm
  var INTERDICT_CHANCE = 0.30;  // jump interdiction roll when at war / wanted
  var BLOCKADE_CLEAR_DAYS = 5;  // triggered blockades stay clear this long
  var FACTIONS = ['compact', 'drifters', 'ember'];

  var layout = null;            // {storms, blockades, day, seedStr}
  var travelHooked = false, mapHooked = false, driftIv = null;
  var forceInterdict = null;    // test hook: true/false forces the roll, null = normal

  function toast(msg) { try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {} }
  function play(id) { try { if (SF.Audio && typeof SF.Audio.sfx === 'function') SF.Audio.sfx(id); } catch (e) {} }

  function genLayout() {
    var rnd = mulberry32(hashStr('starfall-hazards|' + todayStr()));
    var storms = [], i;
    var n = 2 + Math.floor(rnd() * 2); // 2-3 storms per map
    for (i = 0; i < n; i++) {
      storms.push({
        x: 14 + rnd() * 72, y: 14 + rnd() * 72, r: 8 + rnd() * 5,
        vx: (rnd() - 0.5) * 1.4, vy: (rnd() - 0.5) * 1.4
      });
    }
    var lanes = [['solace', 'ember'], ['drift', 'ember'], ['solace', 'drift']];
    var blockades = [];
    lanes.forEach(function (L) {
      var richLane = RICH.indexOf(L[0]) >= 0 || RICH.indexOf(L[1]) >= 0;
      if (!richLane || rnd() >= 0.8) return;
      var a = POS[L[0]], b = POS[L[1]];
      blockades.push({
        from: L[0], to: L[1],
        x: (a.x + b.x) / 2 + (rnd() - 0.5) * 7,
        y: (a.y + b.y) / 2 + (rnd() - 0.5) * 7,
        clearedUntil: 0
      });
    });
    if (!blockades.length) { // guarantee at least one blockade on the rim lane
      var a2 = POS.solace, b2 = POS.ember;
      blockades.push({ from: 'solace', to: 'ember', x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2, clearedUntil: 0 });
    }
    return { storms: storms, blockades: blockades, day: 1, seedStr: todayStr() };
  }

  function ensure() { if (!layout) layout = genLayout(); return layout; }

  /* distance from point p to segment ab (map % units) */
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function hostileFactions() {
    var out = [];
    try {
      if (SF.Factions && typeof SF.Factions.stance === 'function') {
        FACTIONS.forEach(function (f) { if (SF.Factions.stance(f) === 'hostile') out.push(f); });
      }
    } catch (e) {}
    return out;
  }

  function checkRoute(fromId, toId) {
    var L = ensure();
    var res = { storms: [], blockade: null, interdict: false, interdictBy: null };
    var a = POS[fromId], b = POS[toId];
    if (!a || !b) return res;
    L.storms.forEach(function (s, i) {
      if (segDist(s.x, s.y, a.x, a.y, b.x, b.y) < s.r) res.storms.push(i);
    });
    L.blockades.forEach(function (bd) {
      var sameLane = (bd.from === fromId && bd.to === toId) || (bd.from === toId && bd.to === fromId);
      if (sameLane && L.day > bd.clearedUntil) res.blockade = bd;
    });
    var hostile = hostileFactions();
    var wanted = !!(SF.Blackmarket && SF.Blackmarket.heat);
    if (hostile.length || wanted) {
      var roll = forceInterdict !== null ? forceInterdict : (Math.random() < INTERDICT_CHANCE);
      if (roll) { res.interdict = true; res.interdictBy = hostile[0] || 'wanted'; }
    }
    return res;
  }

  function factionName(id) {
    try {
      if (SF.FACTION_BY_ID && SF.FACTION_BY_ID[id]) return SF.FACTION_BY_ID[id].name;
    } catch (e) {}
    return id;
  }

  function spawnAmbush() {
    try {
      if (SF.Encounters && typeof SF.Encounters.run === 'function') SF.Encounters.run('ambush');
    } catch (e) {}
  }

  function onArrival(res, destId) {
    var L = ensure();
    if (res.storms.length) {
      var dmg = STORM_DMG * res.storms.length;
      try {
        var before = SF.Player.shield || 0;
        SF.Player.shield = Math.max(0, before - dmg);
      } catch (e) {}
      toast('\u26C8 Radiation storm crossed in transit \u2014 shields took a hit (-' + dmg + ')');
      play('hazard_storm_enter');
    }
    if (res.blockade) {
      res.blockade.clearedUntil = L.day + BLOCKADE_CLEAR_DAYS;
      toast('\u2620 Pirate blockade on the lane \u2014 ambush!');
      play('blockade_alarm');
      spawnAmbush();
    }
    if (res.interdict) {
      var who = (res.interdictBy && res.interdictBy !== 'wanted') ? factionName(res.interdictBy) : 'A hostile patrol';
      toast('\uD83D\uDEA8 Interdicted! ' + who + ' pulled you out of the jump lane!');
      play('blockade_alarm');
      spawnAmbush();
    }
    L.day++; // every jump is a travel day
  }

  /* ---------------- map overlay markers ---------------- */
  function injectCSS() {
    if (document.getElementById('hazards-css')) return;
    var st = document.createElement('style');
    st.id = 'hazards-css';
    st.textContent =
      '@keyframes hz-pulse{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.08);opacity:1}}' +
      '.hz-layer{position:absolute;inset:0;pointer-events:none;z-index:5}' +
      '.hz-storm{position:absolute;border:2px dashed #ff5e3a;border-radius:50%;' +
      'background:radial-gradient(circle,rgba(255,94,58,.10) 55%,rgba(255,94,58,.28) 100%);' +
      'animation:hz-pulse 2.4s ease-in-out infinite}' +
      '.hz-storm-label{position:absolute;color:#ffb08a;font-size:10px;letter-spacing:1px;' +
      'transform:translate(-50%,-130%);white-space:nowrap}' +
      '.hz-blockade{position:absolute;transform:translate(-50%,-50%);font-size:18px;' +
      'animation:hz-pulse 1.7s ease-in-out infinite;filter:drop-shadow(0 0 4px #ff3b30)}' +
      '.hz-blockade-label{position:absolute;transform:translate(-50%,30%);color:#ff8c7a;' +
      'font-size:9px;letter-spacing:1px;white-space:nowrap}';
    document.head.appendChild(st);
  }

  function clearMarkers() {
    var old = document.getElementById('hz-layer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function renderMarkers() {
    var L = ensure();
    injectCSS();
    var wrap = document.getElementById('starmap-systems');
    if (!wrap) return;
    try {
      if (window.getComputedStyle && getComputedStyle(wrap).position === 'static') {
        wrap.style.position = 'relative';
      }
    } catch (e) {}
    clearMarkers();
    var layer = document.createElement('div');
    layer.id = 'hz-layer';
    layer.className = 'hz-layer';
    L.storms.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'hz-storm';
      d.style.left = (s.x - s.r) + '%'; d.style.top = (s.y - s.r) + '%';
      d.style.width = (s.r * 2) + '%'; d.style.height = (s.r * 2) + '%';
      d.title = 'Radiation storm \u2014 jumps through it cost shields';
      var lab = document.createElement('div');
      lab.className = 'hz-storm-label';
      lab.style.left = s.x + '%'; lab.style.top = (s.y - s.r) + '%';
      lab.textContent = '\u2622 STORM';
      layer.appendChild(d); layer.appendChild(lab);
    });
    L.blockades.forEach(function (bd) {
      if (L.day <= bd.clearedUntil) return; // cleared: hidden from the map
      var d = document.createElement('div');
      d.className = 'hz-blockade';
      d.style.left = bd.x + '%'; d.style.top = bd.y + '%';
      d.textContent = '\u2620';
      d.title = 'Pirate blockade \u2014 ambush on the lane';
      var lab = document.createElement('div');
      lab.className = 'hz-blockade-label';
      lab.style.left = bd.x + '%'; lab.style.top = bd.y + '%';
      lab.textContent = 'BLOCKADE';
      layer.appendChild(d); layer.appendChild(lab);
    });
    wrap.appendChild(layer);
    var info = document.getElementById('starmap-info');
    if (info && !/Travel day/.test(info.textContent)) {
      info.textContent += ' Travel day ' + L.day +
        '. \u2622 storms drain shields in transit \u00B7 \u2620 blockades ambush.';
    }
  }

  function driftTick() {
    var L = ensure(), moved = false;
    L.storms.forEach(function (s) {
      s.x += s.vx; s.y += s.vy;
      if (s.x < 8 || s.x > 92) { s.vx = -s.vx; s.x = Math.max(8, Math.min(92, s.x)); }
      if (s.y < 8 || s.y > 92) { s.vy = -s.vy; s.y = Math.max(8, Math.min(92, s.y)); }
      moved = true;
    });
    if (moved) renderMarkers();
  }
  function startDrift() { stopDrift(); driftIv = setInterval(driftTick, 900); }
  function stopDrift() { if (driftIv) { clearInterval(driftIv); driftIv = null; } }

  /* ---------------- hooks (deferred where needed) ---------------- */
  function hookTravel() {
    if (travelHooked) return true;
    if (!SF.Game || typeof SF.Game.travelTo !== 'function') return false;
    var orig = SF.Game.travelTo;
    var w = function (systemId) {
      var from = SF.Game.systemId;
      var res = checkRoute(from, systemId);
      var r = orig.apply(this, arguments);
      try { onArrival(res, systemId); } catch (e) {}
      return r;
    };
    w._hazardsWrapped = true;
    SF.Game.travelTo = w;
    travelHooked = true;
    return true;
  }

  function hookMap() {
    if (mapHooked || !SF.Starmap || typeof SF.Starmap.open !== 'function') return false;
    var o = SF.Starmap.open, c = SF.Starmap.close;
    var wo = function () {
      var r = o.apply(this, arguments);
      try { ensure(); renderMarkers(); startDrift(); } catch (e) {}
      return r;
    };
    wo._hazardsWrapped = true;
    SF.Starmap.open = wo;
    var wc = function () {
      try { stopDrift(); clearMarkers(); } catch (e) {}
      return c.apply(this, arguments);
    };
    wc._hazardsWrapped = true;
    SF.Starmap.close = wc;
    mapHooked = true;
    return true;
  }

  hookMap(); // SF.Starmap exists already (defined above in this file)
  if (!hookTravel() && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (hookTravel()) clearInterval(iv); }, 500);
  }

  return {
    checkRoute: checkRoute,
    testState: function () {
      var L = ensure();
      return {
        day: L.day, seed: L.seedStr, travelHooked: travelHooked,
        storms: L.storms.map(function (s) {
          return { x: +s.x.toFixed(2), y: +s.y.toFixed(2), r: +s.r.toFixed(2) };
        }),
        blockades: L.blockades.map(function (b) {
          return { from: b.from, to: b.to, clearedUntil: b.clearedUntil };
        })
      };
    },
    testSetStorm: function (i, x, y, r) {
      var L = ensure(), s = L.storms[i];
      if (!s) return false;
      s.x = x; s.y = y; s.r = r; s.vx = 0; s.vy = 0;
      return true;
    },
    testPlaceBlockade: function (from, to) {
      var L = ensure(), a = POS[from], b = POS[to];
      if (!a || !b) return false;
      L.blockades.push({ from: from, to: to, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, clearedUntil: 0 });
      return true;
    },
    testForceInterdict: function (v) { forceInterdict = v; },
    testClearBlockades: function () { ensure().blockades.length = 0; },
    testReset: function () { layout = null; forceInterdict = null; }
  };
})();

/* ================= starmap-notes phase (2026-10-21) =================
 * SF.StarNotes: player-pinned waypoint notes on the star map.
 *
 * - Open the star map [M], tap "📌 PIN NOTE" -> pin your CURRENT system
 *   with a label. Presets: Cache / Danger / Trade / Secret; Custom takes
 *   short free text (SF.Dialog modal on desktop, inline input field on touch).
 * - Notes render as small kind-colored markers on the map above their
 *   system node (stacked when several share a system). Clicking a marker
 *   selects it and shows a chip with the label + a DELETE button.
 * - Persisted in localStorage 'starfall_starmap_notes_v1' (own slot) —
 *   save-neutral, no SAVE_VERSION bump, survives save wipes, shown back
 *   on every map open across sessions.
 *
 * Additive only: wraps SF.Starmap.open/close (idempotent, chains through
 * the other phases' wraps the way starmap-hazards does), runtime-created
 * DOM, its own CSS. index.html, css/, main.js and the closures above in
 * this file are untouched. Jump logic is untouched.
 */
window.SF = window.SF || {};

SF.StarNotes = (function () {
  'use strict';
  var SF = window.SF;

  var KEY = 'starfall_starmap_notes_v1';
  var MAX_LEN = 32;
  var MAX_PER_SYSTEM = 12;
  var MARKER_LIFT = 30;   // px above the system node for the first note
  var MARKER_STEP = 26;   // px between stacked notes

  /* map node positions in % (mirror of the starmap closure's POS) */
  var POS = { solace: { x: 22, y: 55 }, drift: { x: 52, y: 30 }, ember: { x: 78, y: 62 } };

  var KINDS = {
    cache:  { icon: '\uD83D\uDCE6', color: '#ffb347', name: 'Cache' },
    danger: { icon: '\u2620',       color: '#ff5a5a', name: 'Danger' },
    trade:  { icon: '\u25C8',       color: '#5ac8ff', name: 'Trade' },
    secret: { icon: '\u2756',       color: '#c58aff', name: 'Secret' },
    custom: { icon: '\u270E',       color: '#ffd166', name: 'Custom' }
  };

  var notes = null;       // lazy-loaded array of {id, systemId, kind, label, createdAt}
  var selectedId = null;
  var hooked = false;

  /* ---------------- helpers ---------------- */

  function isTouch() {
    try {
      return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    } catch (e) { return false; }
  }

  function toast(msg) {
    try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {}
  }

  function play(id) {
    try { if (SF.Audio && typeof SF.Audio[id] === 'function') SF.Audio[id](); } catch (e) {}
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function sysName(id) {
    try {
      if (SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) return SF.SYSTEM_BY_ID[id].name;
    } catch (e) {}
    return id;
  }

  function curSystem() {
    try { return (SF.Game && SF.Game.systemId) || 'solace'; } catch (e) { return 'solace'; }
  }

  /* ---------------- storage ---------------- */

  function validNote(n) {
    return !!(n && typeof n.id === 'string' && typeof n.systemId === 'string' &&
      KINDS[n.kind] && typeof n.label === 'string');
  }

  function load() {
    if (notes) return notes;
    notes = [];
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) notes = arr.filter(validNote);
      }
    } catch (e) {}
    return notes;
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(notes || [])); } catch (e) {}
  }

  function notesFor(systemId) {
    return load().filter(function (n) { return n.systemId === systemId; });
  }

  /* ---------------- public API ---------------- */

  function addNote(systemId, kind, label) {
    if (!KINDS[kind]) return null;
    label = String(label == null ? '' : label).slice(0, MAX_LEN).trim();
    if (!label) return null;
    if (notesFor(systemId).length >= MAX_PER_SYSTEM) {
      toast('Too many notes on this system');
      play('deny');
      return null;
    }
    var n = { id: uid(), systemId: systemId, kind: kind, label: label, createdAt: Date.now() };
    load().push(n);
    save();
    renderNotes();
    play('ui');
    toast('\uD83D\uDCCC Note pinned: ' + label);
    return n;
  }

  function removeNote(id) {
    var before = load().length;
    notes = load().filter(function (n) { return n.id !== id; });
    if (selectedId === id) selectedId = null;
    if (notes.length !== before) {
      save();
      renderNotes();
      play('uiBack');
      toast('Note deleted');
      return true;
    }
    return false;
  }

  function selectNote(id) {
    selectedId = (selectedId === id) ? null : id; // toggle
    renderNotes();
    play('ui');
  }

  function allNotes() { return load().slice(); }

  /* ---------------- DOM ---------------- */

  function injectCSS() {
    if (document.getElementById('notes-css')) return;
    var st = document.createElement('style');
    st.id = 'notes-css';
    st.textContent =
      '#notes-layer{position:absolute;inset:0;pointer-events:none;z-index:6}' +
      '.note-marker{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;' +
      'cursor:pointer;font-size:16px;line-height:1;filter:drop-shadow(0 0 3px rgba(0,0,0,.8))}' +
      '.note-marker.selected{outline:2px solid #fff;outline-offset:2px;border-radius:4px}' +
      '.note-chip{position:absolute;transform:translate(-50%,-110%);pointer-events:auto;' +
      'background:rgba(8,14,24,.95);border:1px solid #3af;color:#eaf6ff;border-radius:6px;' +
      'padding:4px 8px;font-size:12px;white-space:nowrap;z-index:7}' +
      '.note-chip .note-del{margin-left:8px;color:#ff8a8a;cursor:pointer;' +
      'background:none;border:none;font-size:12px}' +
      '#note-picker{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'background:rgba(8,14,24,.97);border:1px solid #3af;border-radius:8px;' +
      'padding:12px;z-index:50;display:flex;flex-direction:column;gap:8px;min-width:200px}' +
      '#note-picker h3{margin:0 0 4px;font-size:14px;color:#9adcff}' +
      '#note-picker .btn{margin:0}' +
      '#note-picker input[type=text]{padding:8px;font-size:14px;border-radius:4px;' +
      'border:1px solid #3af;background:#0b1626;color:#eaf6ff}';
    document.head.appendChild(st);
  }

  function closePicker() {
    var p = document.getElementById('note-picker');
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  function clearLayer() {
    var l = document.getElementById('notes-layer');
    if (l && l.parentNode) l.parentNode.removeChild(l);
  }

  function renderNotes() {
    injectCSS();
    var wrap = document.getElementById('starmap-systems');
    if (!wrap) return;
    try {
      if (window.getComputedStyle && getComputedStyle(wrap).position === 'static') {
        wrap.style.position = 'relative';
      }
    } catch (e) {}
    clearLayer();
    var layer = document.createElement('div');
    layer.id = 'notes-layer';
    Object.keys(POS).forEach(function (sysId) {
      var sysNotes = notesFor(sysId);
      sysNotes.forEach(function (n, i) {
        var kind = KINDS[n.kind];
        var m = document.createElement('div');
        m.className = 'note-marker' + (selectedId === n.id ? ' selected' : '');
        m.dataset.noteId = n.id; // starmap-notes: stable selector for tests
        m.style.left = POS[sysId].x + '%';
        m.style.top = POS[sysId].y + '%';
        m.style.marginTop = (-MARKER_LIFT - i * MARKER_STEP) + 'px';
        m.style.color = kind.color;
        m.textContent = kind.icon;
        m.title = n.label + ' — tap to select';
        (function (id) {
          m.addEventListener('click', function (ev) { ev.stopPropagation(); selectNote(id); });
        })(n.id);
        layer.appendChild(m);
        if (selectedId === n.id) {
          var chip = document.createElement('div');
          chip.className = 'note-chip';
          chip.id = 'note-chip';
          chip.style.left = POS[sysId].x + '%';
          chip.style.top = POS[sysId].y + '%';
          chip.style.marginTop = (-MARKER_LIFT - i * MARKER_STEP) + 'px';
          chip.innerHTML = '<span class="note-label">' + escHtml(n.label) + '</span>' +
            '<button class="note-del" aria-label="delete note">\u2715 DELETE</button>';
          chip.querySelector('.note-del').addEventListener('click', function (ev) {
            ev.stopPropagation();
            removeNote(n.id);
          });
          layer.appendChild(chip);
        }
      });
    });
    wrap.appendChild(layer);
  }

  function askCustomText(cb) {
    // Touch: inline input inside the picker (handled inline by openPicker).
    if (isTouch()) { if (cb) cb(null); return; }
    /* dialog-sweep-1: SF.Dialog modal, not window.prompt — the Android
     * shell has no WebChromeClient, so prompt() always returns null on
     * device and the custom note silently never got added. Async now:
     * the callback receives the entered text (or never fires on cancel). */
    if (window.SF && SF.Dialog && SF.Dialog.prompt) {
      SF.Dialog.prompt('Short note (max ' + MAX_LEN + ' chars):', '', function (v) { if (cb) cb(v); });
    } else if (cb) cb(null);
  }

  function openPicker() {
    closePicker();
    injectCSS();
    var panel = document.querySelector('#overlay-starmap .panel');
    if (!panel) return;
    try {
      if (window.getComputedStyle && getComputedStyle(panel).position === 'static') {
        panel.style.position = 'relative';
      }
    } catch (e) {}
    var sysId = curSystem();
    var p = document.createElement('div');
    p.id = 'note-picker';
    var h = document.createElement('h3');
    h.textContent = '\uD83D\uDCCC Pin note here (' + sysName(sysId) + ')';
    p.appendChild(h);
    Object.keys(KINDS).forEach(function (kind) {
      if (kind === 'custom') return;
      var b = document.createElement('button');
      b.className = 'btn';
      b.dataset.kind = kind; // starmap-notes: stable selector for tests
      b.style.color = KINDS[kind].color;
      b.textContent = KINDS[kind].icon + ' ' + KINDS[kind].name;
      b.addEventListener('click', function () {
        closePicker();
        addNote(sysId, kind, KINDS[kind].name);
      });
      p.appendChild(b);
    });
    if (isTouch()) {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'note-custom-text';
      inp.maxLength = MAX_LEN;
      inp.placeholder = 'Custom note\u2026';
      p.appendChild(inp);
      var ok = document.createElement('button');
      ok.className = 'btn';
      ok.id = 'note-custom-save';
      ok.textContent = '\u2714 Pin custom note';
      ok.addEventListener('click', function () {
        var v = inp.value;
        closePicker();
        addNote(sysId, 'custom', v);
      });
      p.appendChild(ok);
    } else {
      var cb = document.createElement('button');
      cb.className = 'btn';
      cb.id = 'note-custom-btn';
      cb.textContent = '\u270E Custom\u2026';
      cb.addEventListener('click', function () {
        /* dialog-sweep-1: async DOM modal — picker closes when it settles */
        askCustomText(function (v) {
          closePicker();
          if (v !== null && v !== '') addNote(sysId, 'custom', v);
        });
      });
      p.appendChild(cb);
    }
    var cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.id = 'note-picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () { closePicker(); play('uiBack'); });
    p.appendChild(cancel);
    panel.appendChild(p);
    play('ui');
  }

  function injectPinButton() {
    injectCSS();
    var panel = document.querySelector('#overlay-starmap .panel');
    var closeBtn = document.getElementById('btn-starmap-close');
    if (panel && closeBtn && !document.getElementById('btn-note-pin')) {
      var b = document.createElement('button');
      b.id = 'btn-note-pin';
      b.className = 'btn big ui-block';
      b.style.marginTop = '8px';
      b.textContent = '\uD83D\uDCCC PIN NOTE';
      b.addEventListener('click', function () {
        try { if (SF.Audio) SF.Audio.unlock(); } catch (e) {}
        openPicker();
      });
      panel.insertBefore(b, closeBtn);
    }
  }

  function clearAll() {
    closePicker();
    clearLayer();
    selectedId = null;
  }

  /* ---------------- hooks (deferred-safe, idempotent) ---------------- */

  function hookMap() {
    if (hooked) return true;
    if (!SF.Starmap || typeof SF.Starmap.open !== 'function') return false;
    var o = SF.Starmap.open, c = SF.Starmap.close;
    if (o._notesWrapped) { hooked = true; return true; }
    var wo = function () {
      var r = o.apply(this, arguments);
      try { selectedId = null; injectPinButton(); renderNotes(); } catch (e) {}
      return r;
    };
    wo._notesWrapped = true;
    SF.Starmap.open = wo;
    var wc = function () {
      try { clearAll(); } catch (e) {}
      return c.apply(this, arguments);
    };
    wc._notesWrapped = true;
    SF.Starmap.close = wc;
    hooked = true;
    return true;
  }

  hookMap(); // SF.Starmap exists already (defined above in this file)
  if (!hooked && typeof setInterval !== 'undefined') {
    var iv = setInterval(function () { if (hookMap()) clearInterval(iv); }, 500);
  }

  return {
    addNote: addNote,
    removeNote: removeNote,
    selectNote: selectNote,
    allNotes: allNotes,
    notesFor: notesFor,
    storageKey: KEY,
    isTouch: isTouch,
    testReset: function () {
      notes = []; selectedId = null;
      try { window.localStorage.removeItem(KEY); } catch (e) {}
      clearAll();
    }
  };
})();

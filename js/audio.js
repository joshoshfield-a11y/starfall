/* STARFALL audio-expansion — audio.js
 * WebAudio synthesized SFX + procedural per-system music. No external files.
 * - Master bus: masterGain -> DynamicsCompressor -> destination.
 * - Per-category gains: sfxBus, musicBus -> master. Settings: master / sfx /
 *   music sliders + mute, persisted in localStorage 'starfall_audio_v1'
 *   (same pattern as graphics quality; legacy 'starfall_muted' migrated).
 * - SFX are throttled (laser spam can't stack 30 voices) and layered.
 * - SF.Music: generative per-system themes (title / solace / drift / ember /
 *   docked), lookahead scheduler, crossfades on game-state change, a light
 *   combat percussion layer when enemies are near. Self-driving: reads
 *   SF.Game.state + SF.Game.systemId, so no other file needs edits.
 * - Settings overlay markup lives in index.html (#overlay-settings);
 *   all wiring is here (audio-settings IIFE at the bottom).
 */
window.SF = window.SF || {};

SF.Audio = (function () {
  var STORE_KEY = 'starfall_audio_v1';

  function clamp01(v) { v = Number(v); if (isNaN(v)) return 1; return Math.max(0, Math.min(1, v)); }

  var settings = { master: 1.0, sfx: 1.0, music: 0.7, muted: false };
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  (function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s.master === 'number') settings.master = clamp01(s.master);
        if (typeof s.sfx === 'number') settings.sfx = clamp01(s.sfx);
        if (typeof s.music === 'number') settings.music = clamp01(s.music);
        if (typeof s.muted === 'boolean') settings.muted = s.muted;
        return;
      }
      // legacy: plain mute flag from the pre-expansion build
      if (localStorage.getItem('starfall_muted') === '1') {
        settings.muted = true;
        try { localStorage.removeItem('starfall_muted'); } catch (e2) {}
        saveSettings();
      }
    } catch (e) { /* storage unavailable: run with defaults */ }
  })();

  var listeners = [];
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](settings); } catch (e) {}
    }
  }

  /* ---------------- bus ---------------- */
  var ctx = null, master = null, sfxBus = null, musicBus = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-18, ctx.currentTime);
      comp.knee.setValueAtTime(22, ctx.currentTime);
      comp.ratio.setValueAtTime(8, ctx.currentTime);
      comp.attack.setValueAtTime(0.003, ctx.currentTime);
      comp.release.setValueAtTime(0.24, ctx.currentTime);
      comp.connect(ctx.destination);
      master = ctx.createGain(); master.connect(comp);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.connect(master);
      applyVolumes();
    } catch (e) { ctx = null; }
    return ctx;
  }

  function applyVolumes() {
    if (!ctx) return;
    var t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0.0001 : settings.master, t, 0.05);
    sfxBus.gain.setTargetAtTime(Math.max(0.0001, settings.sfx), t, 0.05);
    musicBus.gain.setTargetAtTime(Math.max(0.0001, settings.music), t, 0.1);
  }

  /* ---------------- primitives ---------------- */
  function env(g, t0, peak, dur, attack) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone(freq0, freq1, dur, type, peak, opt) {
    if (settings.muted) return;
    var c = ensure(); if (!c) return;
    opt = opt || {};
    try {
      var t0 = c.currentTime + (opt.delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(Math.max(1, freq0), t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t0 + dur);
      env(g, t0, (peak || 0.12) * settings.sfx, dur, opt.attack);
      o.connect(g); g.connect(opt.bus || sfxBus);
      o.start(t0); o.stop(t0 + dur + 0.08);
    } catch (e) { /* ignore */ }
  }

  function noise(dur, peak, lowpass, opt) {
    if (settings.muted) return;
    var c = ensure(); if (!c) return;
    opt = opt || {};
    try {
      var t0 = c.currentTime + (opt.delay || 0);
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource(); src.buffer = buf;
      var f = c.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(lowpass || 1200, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, (lowpass || 1200) * 0.12), t0 + dur);
      var node = f;
      if (opt.highpass) {
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = opt.highpass;
        f.connect(hp); node = hp;
      }
      var g = c.createGain();
      env(g, t0, (peak || 0.25) * settings.sfx, dur, opt.attack);
      src.connect(f); node.connect(g); g.connect(opt.bus || sfxBus);
      src.start(t0);
    } catch (e) { /* ignore */ }
  }

  /* Throttle: repeated rapid triggers (laser spam, explosions) don't stack. */
  var lastPlay = {};
  function gate(name, minMs) {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (lastPlay[name] && now - lastPlay[name] < minMs) return false;
    lastPlay[name] = now;
    return true;
  }

  /* ---------------- public API ---------------- */
  var api = {
    unlock: function () { // call on first user gesture
      var c = ensure();
      if (c && c.state === 'suspended') { c.resume().catch(function () {}); }
      if (typeof SF.Music !== 'undefined' && SF.Music.kick) SF.Music.kick();
    },
    isMuted: function () { return settings.muted; },
    toggleMute: function () {
      settings.muted = !settings.muted;
      saveSettings(); applyVolumes(); notify();
      return settings.muted;
    },
    getVolume: function (kind) {
      return (kind === 'master' || kind === 'sfx' || kind === 'music') ? settings[kind] : 1;
    },
    setVolume: function (kind, v) {
      if (kind !== 'master' && kind !== 'sfx' && kind !== 'music') return settings;
      settings[kind] = clamp01(v);
      saveSettings(); applyVolumes(); notify();
      return settings[kind];
    },
    resetVolumes: function () {
      settings.master = 1.0; settings.sfx = 1.0; settings.music = 0.7; settings.muted = false;
      saveSettings(); applyVolumes(); notify();
    },
    settings: function () {
      return { master: settings.master, sfx: settings.sfx, music: settings.music, muted: settings.muted };
    },
    onSettingsChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    _ctx: function () { return ctx; }, // test hook

    /* ---- core SFX (pre-expansion set, kept; some re-layered) ---- */
    laser:      function () { if (!gate('laser', 50)) return; tone(880, 220, 0.12, 'square', 0.07); },
    enemyLaser: function () { if (!gate('elaser', 70)) return; tone(330, 110, 0.16, 'sawtooth', 0.05); },
    missile:    function () { if (!gate('missile', 120)) return; noise(0.35, 0.10, 900); tone(200, 600, 0.3, 'sine', 0.05); },
    explosion:  function (big) {
      if (!gate('expl', 90)) return;
      noise(big ? 0.7 : 0.4, big ? 0.35 : 0.22, big ? 900 : 1400);
      tone(big ? 90 : 70, 28, big ? 0.6 : 0.35, 'sine', big ? 0.30 : 0.18); // sub thump
    },
    hit:        function () { if (!gate('hit', 60)) return; tone(160, 60, 0.15, 'sawtooth', 0.12); },
    shieldHit:  function () { if (!gate('sh', 60)) return; tone(1200, 500, 0.1, 'sine', 0.08); },
    pickup:     function () { if (!gate('pickup', 60)) return; tone(660, 1320, 0.12, 'sine', 0.10); },
    credit:     function () { if (!gate('credit', 60)) return; tone(990, 1980, 0.09, 'sine', 0.08); },
    dock:       function () {
      tone(392, 392, 0.18, 'sine', 0.10);
      tone(523, 523, 0.22, 'sine', 0.10, { delay: 0.14 });
      tone(659, 659, 0.30, 'sine', 0.09, { delay: 0.28 });
    },
    buy:        function () { tone(523, 784, 0.14, 'sine', 0.10); tone(784, 1046, 0.16, 'sine', 0.09, { delay: 0.10 }); },
    deny:       function () { if (!gate('deny', 120)) return; tone(220, 140, 0.2, 'square', 0.08); },
    ui:         function () { if (!gate('ui', 40)) return; tone(700, 900, 0.06, 'sine', 0.06); },
    uiBack:     function () { if (!gate('ui', 40)) return; tone(600, 420, 0.07, 'sine', 0.06); },
    jump:       function () { tone(150, 900, 0.5, 'sawtooth', 0.10); noise(0.5, 0.08, 2000); },
    jumpCharge: function () { tone(120, 1400, 0.9, 'sawtooth', 0.07); tone(2400, 4800, 0.5, 'sine', 0.04, { delay: 0.4 }); },
    gameOver:   function () { tone(400, 50, 1.2, 'sawtooth', 0.16); noise(1.0, 0.2, 700); },
    startGame:  function () { // new-game fanfare
      var n = [261.6, 329.6, 392.0, 523.3];
      for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.22, 'triangle', 0.12, { delay: i * 0.11 });
      noise(0.8, 0.05, 6000, { delay: 0.4 });
    },
    respawn:    function () { tone(200, 1200, 0.7, 'sine', 0.12); tone(400, 2400, 0.5, 'triangle', 0.06, { delay: 0.15 }); },

    /* ---- weapons-arsenal per-weapon SFX (kept) ---- */
    railgun:    function () { if (!gate('rail', 90)) return; tone(1400, 120, 0.25, 'sawtooth', 0.12); noise(0.2, 0.15, 3000); },
    repeater:   function () { if (!gate('rep', 50)) return; tone(1200, 500, 0.08, 'square', 0.06); },
    flak:       function () { if (!gate('flak', 90)) return; noise(0.25, 0.25, 800); tone(300, 80, 0.18, 'square', 0.10); },
    beam:       function () { if (!gate('beam', 70)) return; tone(1800, 900, 0.15, 'sawtooth', 0.05); tone(900, 1800, 0.12, 'sine', 0.05); },
    torpedo:    function () { if (!gate('torp', 140)) return; tone(150, 500, 0.4, 'sine', 0.10); noise(0.3, 0.08, 700); },
    emp:        function () { if (!gate('emp', 140)) return; tone(2200, 200, 0.3, 'square', 0.08); tone(110, 40, 0.35, 'sawtooth', 0.10); },
    mine:       function () { if (!gate('mine', 120)) return; tone(500, 150, 0.2, 'sine', 0.08); },
    starfall:   function () { if (!gate('sfall', 120)) return; tone(2400, 300, 0.3, 'sawtooth', 0.08); noise(0.25, 0.12, 4000); tone(600, 2400, 0.2, 'square', 0.05); },
    /* ---- twelve-hour-wave2: feel/juice voices (synth only, no new files) ----
     * scatter: 5-pellet spread gets its own short noise crackle (was falling
     *   through to the generic laser); heavy: one low thump for the big
     *   single slugs (hellbore / annihilator / event horizon, were flak);
     * crit: bright ping on a gunner-perk crit landing (previously silent —
     *   the crit number existed but no cue); killConfirm: soft two-note
     *   rise on a non-boss kill (explosion alone carried it before);
     * levelUp: distinct rising arpeggio for skill level-ups (previously
     *   reused the credit blip). All gated like their neighbours. */
    scatter:    function () { if (!gate('scat', 90)) return; noise(0.18, 0.12, 1200); tone(500, 180, 0.12, 'square', 0.07); },
    heavy:      function () { if (!gate('heavy', 140)) return; tone(110, 45, 0.4, 'sine', 0.20); noise(0.3, 0.2, 500); },
    crit:       function () { if (!gate('crit', 90)) return; tone(1568, 2093, 0.12, 'sine', 0.09); tone(2093, 2637, 0.14, 'sine', 0.06, { delay: 0.06 }); },
    killConfirm:function () { if (!gate('kill', 120)) return; tone(880, 880, 0.09, 'sine', 0.07); tone(1320, 1320, 0.12, 'sine', 0.06, { delay: 0.08 }); },
    levelUp:    function () {
      var n = [523, 659, 784, 1046];
      for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.18, 'triangle', 0.10, { delay: i * 0.09 });
    },
    mod:        function () { tone(440, 880, 0.1, 'sine', 0.09); tone(880, 1320, 0.12, 'sine', 0.08, { delay: 0.09 }); },

    /* ---- audio-expansion: full SFX pass (new, unhooked — see REPORT.md) ---- */
    questAccept: function () { tone(523, 523, 0.12, 'triangle', 0.10); tone(784, 784, 0.2, 'triangle', 0.10, { delay: 0.10 }); },
    questTurnIn: function () {
      var n = [523, 659, 784, 1046];
      for (var i = 0; i < n.length; i++) tone(n[i], n[i] * 1.01, 0.18, 'sine', 0.09, { delay: i * 0.09 });
      tone(2093, 2093, 0.4, 'sine', 0.04, { delay: 0.36 });
    },
    questFail:  function () { tone(392, 392, 0.16, 'triangle', 0.10); tone(311, 233, 0.3, 'triangle', 0.10, { delay: 0.14 }); },
    craft:      function () {
      noise(0.12, 0.20, 2500, { highpass: 800 });
      tone(1200, 900, 0.08, 'square', 0.06, { delay: 0.05 });
      tone(1600, 1100, 0.08, 'square', 0.06, { delay: 0.14 });
      tone(880, 1760, 0.25, 'sine', 0.09, { delay: 0.22 });
    },
    salvage:    function () { noise(0.4, 0.12, 1800); tone(800, 200, 0.35, 'sawtooth', 0.07); },
    tradeSell:  function () { tone(990, 1980, 0.09, 'sine', 0.08); tone(1320, 2640, 0.1, 'sine', 0.07, { delay: 0.08 }); },
    hire:       function () {
      var n = [392, 494, 587];
      for (var i = 0; i < n.length; i++) tone(n[i], n[i], 0.3, 'triangle', 0.09, { delay: i * 0.02 });
    },
    dialogue:   function () { if (!gate('dlg', 90)) return; tone(740, 880, 0.05, 'square', 0.045); },
    newsPing:   function () { tone(1568, 1568, 0.12, 'sine', 0.07); tone(2093, 2093, 0.16, 'sine', 0.06, { delay: 0.12 }); },
    anomaly:    function () {
      tone(300, 900, 0.8, 'sine', 0.09);
      tone(450, 200, 0.9, 'sine', 0.07, { delay: 0.2 });
      noise(0.9, 0.05, 3000, { delay: 0.1 });
    },
    dungeonDoor:function () { noise(0.5, 0.25, 400); tone(80, 40, 0.6, 'sawtooth', 0.16); tone(1200, 700, 0.1, 'square', 0.07, { delay: 0.35 }); },
    alert:      function () { if (!gate('alert', 400)) return; tone(880, 440, 0.16, 'sawtooth', 0.12); tone(880, 440, 0.16, 'sawtooth', 0.12, { delay: 0.2 }); noise(0.2, 0.1, 2500); },
    shieldBreak:function () { noise(0.35, 0.28, 6000, { highpass: 1500 }); tone(1800, 300, 0.4, 'square', 0.10); },
    hullAlarm:  function () { if (!gate('hull', 700)) return; for (var i = 0; i < 3; i++) tone(660, 660, 0.09, 'square', 0.09, { delay: i * 0.13 }); },
    lifepod:    function () { tone(880, 880, 0.14, 'sine', 0.09); tone(1174, 1174, 0.2, 'sine', 0.09, { delay: 0.13 }); },
    bounty:     function () { tone(196, 196, 0.2, 'sawtooth', 0.10); tone(147, 147, 0.3, 'sawtooth', 0.10, { delay: 0.18 }); },

    weaponSound: function (wid) {
      var f = this[({
        railgun: 'railgun', sniper: 'railgun', coilgun: 'railgun', lance: 'railgun',
        repeater: 'repeater', storm: 'repeater', shard: 'repeater', vulcan: 'repeater',
        flak: 'flak', beam: 'beam', torpedo: 'torpedo', emp: 'emp',
        minelayer: 'mine', starfall: 'starfall', scatter: 'scatter',
        hellbore: 'heavy', annihilator: 'heavy',
        guardian_lance: 'beam', cinder_reaper: 'missile',
        event_horizon: 'heavy', solar_requiem: 'beam' // secrets-easter-eggs: hidden ultras
      })[wid]];
      if (typeof f === 'function') f.call(this);
      else if (wid === 'seeker' || wid === 'seeker_mk2') this.missile();
      else this.laser();
    }
  };

    /* ---- asset-loader-infra: file-backed loaders (per ASSETS.md) ----
     * playMusic(id): streams assets/audio/music/<id>.ogg via HTMLAudioElement
     *   (low memory, looped), 1.5s A/B crossfade. On 404/error the procedural
     *   SF.Music synth takes over (or keeps playing). The synth scheduler
     *   no-ops while file music is active (see SF.Music tick).
     * playMusicForSystem(systemId): per-system track mapping; probes the file
     *   first so a missing asset never kills the procedural music.
     * stopMusicFile(): hand music back to the procedural synth.
     * sfx(id): WebAudio buffer cache from assets/audio/sfx/<id>.ogg. First
     *   call plays the procedural fallback immediately (zero latency) while
     *   the file loads in the background; once decoded, the file wins.
     *   Any 404/decode failure pins the id to the procedural fallback forever.
     * voice(id): plays assets/audio/voice/<id>.ogg, ducking music to 25%
     *   while the line plays; falls back to the 'dialogue' blip on failure.
     * Every path is safe on missing assets: the game never breaks. */
    var ASSET_BASE = 'assets/';
    var musicFileMode = false;
    var duckFactor = 1;
    var musicSlotA = null, musicSlotB = null, musicFront = 'A';
    var FILE_MUSIC_MAP = {
      // music-mapping-vol23: asset-loader-infra's placeholder ids
      // ('title-theme' etc.) never shipped on disk; point the per-system
      // map at the real tracks (vol 1 REPORT.md ids, vol 2 for drift).
      title: 'sf_title', solace: 'sf_solace', drift: 'sf_drift',
      ember: 'sf_ember', docked: 'sf_station'
    };
    // music-mapping-vol23: gameplay-context -> streamed track id.
    // Vol 2 ids verified in phases/soundtrack-vol-2/REPORT.md
    // (sf_drift, sf_boss, sf_victory, sf_hollow, sf_blackmarket);
    // vol 3 ids verified in phases/soundtrack-vol-3/REPORT.md
    // (sf_celestial, sf_menu, sf_defeat, sf_triumph). No invented ids.
    // Combat maps to sf_boss (vol 3 ships no generic combat track).
    // music-mapping-vol4: vol 4 ids verified in
    // phases/soundtrack-vol-4/REPORT.md
    // (sf_sanctum, sf_arena, sf_outpost, sf_finale). No invented ids.
    var CONTEXT_MUSIC_MAP = {
      combat: 'sf_boss',
      boss: 'sf_boss',
      skirmish: 'sf_combat',   // generic combat (vol 1); boss uses sf_boss
      dungeon: 'sf_hollow',
      dungeon_sanctum: 'sf_sanctum', // Hollow Cathedral sanctum wing (dungeon-depths-2), deeper than sf_hollow
      blackmarket: 'sf_blackmarket',
      victory: 'sf_victory',   // boss/arena win stinger
      finale: 'sf_finale',     // karma-finale victory reprise: play after sf_victory on campaign finale win
      triumph: 'sf_triumph',   // victory-reprise loop once the stinger resolves
      defeat: 'sf_defeat',     // game-over dirge
      menu: 'sf_menu',         // main-menu theme
      celestial: 'sf_celestial',
      arena: 'sf_arena',       // arena-mode championship gauntlets
      outpost: 'sf_outpost'    // mining outpost approach/deploy (mining-outposts)
    };
    // id of the track currently streaming in the file-music slots
    // (null when the procedural synth owns the mix or nothing is playing).
    var currentMusicId = null;
    var sfxFiles = {};   // id -> 'pending' | AudioBuffer
    var sfxMissing = {}; // id -> true (permanently fall back to synth)
    var voiceEl = null;

    function musicEffectiveVolume() {
      return (settings.muted ? 0 : settings.music) * duckFactor;
    }
    function applyMusicVolume() {
      var v = musicEffectiveVolume();
      try {
        if (musicSlotA) musicSlotA.volume = v;
        if (musicSlotB) musicSlotB.volume = v;
      } catch (e) {}
    }

    var SFX_FALLBACK = {
      laser: 'laser', enemyLaser: 'enemyLaser', missile: 'missile',
      explosion: 'explosion', hit: 'hit', shieldHit: 'shieldHit', pickup: 'pickup',
      credit: 'credit', dock: 'dock', buy: 'buy', deny: 'deny', ui: 'ui',
      uiBack: 'uiBack', jump: 'jump', jumpCharge: 'jumpCharge', gameOver: 'gameOver',
      startGame: 'startGame', respawn: 'respawn', railgun: 'railgun', repeater: 'repeater',
      flak: 'flak', beam: 'beam', torpedo: 'torpedo', emp: 'emp', mine: 'mine',
      starfall: 'starfall', mod: 'mod', questAccept: 'questAccept', questTurnIn: 'questTurnIn',
      questFail: 'questFail', craft: 'craft', salvage: 'salvage', tradeSell: 'tradeSell',
      hire: 'hire', dialogue: 'dialogue', newsPing: 'newsPing', anomaly: 'anomaly',
      dungeonDoor: 'dungeonDoor', alert: 'alert', shieldBreak: 'shieldBreak',
      hullAlarm: 'hullAlarm', lifepod: 'lifepod', bounty: 'bounty',
      miningTick: 'salvage', // sfx-route-internals: bank-v1 id with no same-named synth
      // sfx-bank-v7: waves-5/6 + treaties systems (24 ids, verified in phases/sfx-bank-v7/REPORT.md)
      treaty_signed: 'questTurnIn', treaty_broken: 'questFail',
      treaty_expired: 'questFail', treaty_allied: 'lifepod',
      survey_ping: 'newsPing', survey_find: 'anomaly', survey_complete: 'questTurnIn',
      node_deplete: 'salvage', node_rich: 'credit',
      hazard_storm_enter: 'alert', hazard_storm_exit: 'ui', hazard_storm_peak: 'shieldBreak',
      blockade_alarm: 'hullAlarm', blockade_lifted: 'questAccept',
      wingman_order_ack1: 'dialogue', wingman_order_ack2: 'dialogue',
      wingman_order_ack3: 'dialogue', wingman_order_hold: 'dialogue',
      asteroid_deepcrack: 'explosion', asteroid_scan: 'anomaly',
      outpost_claim: 'hire', outpost_upgrade: 'craft', outpost_attack: 'alert',
      mineral_vein_found: 'pickup',
      // sfx-hooks-v6: sfx-bank-v6's 23 ids (verified in phases/sfx-bank-v6/REPORT.md).
      // All alias-only (no same-named synth method): callers reach them via
      // SF.Audio.sfx('<id>') -> OGG buffer-cache path first, synth fallback
      // when the file is missing/undecodable. Fallbacks picked to match each
      // id's game context per the bank-v6 wiring notes.
      boss_phase_shift_1: 'alert', boss_phase_shift_2: 'alert',
      boss_phase_shift_3: 'alert',
      warp_charge_full: 'jumpCharge', engine_wake_start: 'respawn',
      wormhole_stabilize: 'anomaly',
      tractor_beam_lock: 'salvage', mine_detonate_chain: 'explosion',
      boarding_alarm: 'hullAlarm', station_hailing: 'dialogue',
      ngplus_fanfare: 'startGame', prestige_chime: 'newsPing',
      daily_turnin_stamp: 'questTurnIn', ghost_signal_ping: 'anomaly',
      trade_event_bell: 'newsPing', faction_war_siren: 'hullAlarm',
      killstreak_10: 'questTurnIn', killstreak_25: 'questTurnIn',
      killstreak_50: 'questTurnIn', contract_accept_stamp: 'questAccept',
      bounty_claim: 'bounty', shield_crit_warn: 'alert', overload_vent: 'salvage',
      // sfx-hooks-v9: sfx-bank-v8's 19 ids (verified in phases/sfx-bank-v8/REPORT.md)
      // + sfx-bank-v9-retry's 13 ids (verified in phases/sfx-bank-v9-retry/REPORT.md).
      // All alias-only (no same-named synth method): callers reach them via
      // SF.Audio.sfx('<id>') -> OGG buffer-cache path first, synth fallback
      // when the file is missing/undecodable. Fallbacks picked to match each
      // id's game context per the bank-v8 wiring notes.
      // v8: crew morale
      morale_up: 'questTurnIn', morale_down: 'questFail',
      crew_promote: 'questTurnIn', crew_mourn: 'questFail',
      // v8: survey
      survey_ping_far: 'newsPing', survey_ping_near: 'anomaly',
      survey_nothing: 'ui',
      // v8: hazards
      storm_loop: 'alert', storm_graze: 'shieldHit', interdict_warn: 'alert',
      // v8: treaties
      treaty_proposed: 'questAccept', treaty_decline: 'deny',
      treaty_counter: 'dialogue',
      // v8: wingman orders
      wingman_order_attack: 'alert', wingman_order_retreat: 'jump',
      wingman_order_rally: 'dialogue',
      // v8: warp
      jump_exit: 'jump', warp_abort: 'deny', warp_misfire: 'emp',
      // v9: ghost / notes / drones / ledger
      ghost_phasein: 'anomaly', note_pin: 'ui', note_select: 'ui',
      drone_damaged: 'hit', drone_recall: 'respawn', ledger_flip: 'credit',
      // v9: pirate parley / morale / boarding
      parley_hail: 'dialogue', parley_accept: 'questAccept',
      parley_refuse: 'deny', morale_rally: 'startGame',
      breach_alarm: 'hullAlarm', scuttle_warn: 'alert',
      bridge_taken: 'questFail',
      // sfx-bank-v10: 10 ids (verified in phases/sfx-bank-v10/REPORT.md).
      // All alias-only (no same-named synth method): callers reach them via
      // SF.Audio.sfx('<id>') -> OGG buffer-cache path first, synth fallback
      // when the file is missing/undecodable. Fallbacks picked to match each
      // id's game context.
      surface_touchdown: 'dock', survey_motherlode: 'questTurnIn',
      storm_clear: 'questTurnIn', treaty_demilitarized: 'questAccept',
      arena_boo: 'questFail', boss_roar_long: 'alert',
      cache_claim_big: 'bounty', drone_upgrade: 'craft',
      photo_shutter_v2: 'ui', formation_ack: 'dialogue'
    };
    // sfx-route-internals: pre-router synth functions (saved by the router
    // below); synthFallback must call these, NOT api[m] (which is the router
    // after wrapping — calling it would recurse forever).
    var _origSynth = {};
    // sfx-route-internals: test counter — how often synthFallback fired per id
    var synthFallbackCounts = {};
    function synthFallback(id) {
      synthFallbackCounts[id] = (synthFallbackCounts[id] || 0) + 1;
      var m = SFX_FALLBACK[id];
      var fn = (m && _origSynth[m]) || api[m];
      if (typeof fn === 'function') fn();
    }
    function playSfxBuffer(buf) {
      if (settings.muted) return;
      var c = ensure(); if (!c) return;
      try {
        var src = c.createBufferSource(); src.buffer = buf;
        var g = c.createGain();
        g.gain.value = Math.max(0.0001, settings.sfx);
        src.connect(g); g.connect(sfxBus);
        src.start();
      } catch (e) { /* ignore */ }
    }
    function loadSfxFile(id) {
      sfxFiles[id] = 'pending';
      var url = ASSET_BASE + 'audio/sfx/' + id + '.ogg';
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        var c = ensure(); if (!c) throw new Error('no audio ctx');
        return c.decodeAudioData(ab);
      }).then(function (buf) {
        sfxFiles[id] = buf;
      }, function () {
        sfxMissing[id] = true;
        delete sfxFiles[id];
      });
    }

    api._fileModeActive = function () { return musicFileMode; }; // SF.Music hook
    api._duck = function (f) { // voice-line ducking for both music engines
      duckFactor = (typeof f === 'number') ? f : 1;
      applyMusicVolume();
      try { if (SF.Music && SF.Music._setDuck) SF.Music._setDuck(duckFactor); } catch (e) {}
    };

    api.playMusic = function (id) {
      var url = ASSET_BASE + 'audio/music/' + id + '.ogg';
      SF.Audio.unlock();
      var next = new Audio(url);
      next.loop = true; next.preload = 'auto';
      var settled = false;
      function fail() {
        if (settled) return; settled = true;
        musicFileMode = false;
        currentMusicId = null; // music-mapping-vol23: nothing owns the mix now
        try { next.pause(); } catch (e) {}
        try { SF.Music.kick(); } catch (e2) {} // resume procedural synth
      }
      next.addEventListener('error', fail, { once: true });
      next.addEventListener('canplay', function onCan() {
        next.removeEventListener('canplay', onCan);
        if (settled) return; settled = true;
        musicFileMode = true;
        currentMusicId = id; // music-mapping-vol23: this id now owns the mix
        var prev = musicFront === 'A' ? musicSlotA : musicSlotB;
        if (musicFront === 'A') { musicSlotB = next; musicFront = 'B'; }
        else { musicSlotA = next; musicFront = 'A'; }
        var t0 = Date.now(), XF = 1500; // 1.5s crossfade
        try { next.volume = 0; next.play().catch(fail); } catch (e) { fail(); return; }
        var iv = setInterval(function () {
          var k = Math.min(1, (Date.now() - t0) / XF);
          try {
            next.volume = musicEffectiveVolume() * k;
            if (prev) prev.volume = musicEffectiveVolume() * (1 - k);
          } catch (e2) {}
          if (k >= 1) {
            clearInterval(iv);
            if (prev) { try { prev.pause(); } catch (e3) {} }
          }
        }, 50);
      }, { once: true });
      return next;
    };

    // music-mapping-vol23: probe a music file before committing to it, so a
    // missing asset never kills the procedural synth. cb(ok) is async.
    function probeMusic(id, cb) {
      var url = ASSET_BASE + 'audio/music/' + id + '.ogg';
      try {
        fetch(url, { method: 'HEAD' }).then(function (r) {
          cb(!!(r && r.ok));
        }, function () { cb(false); }); // unreachable: keep synth
      } catch (e) { cb(false); }
    }

    api.playMusicForSystem = function (systemId) {
      var id = FILE_MUSIC_MAP[systemId] || FILE_MUSIC_MAP.solace;
      probeMusic(id, function (ok) {
        if (ok) api.playMusic(id); // file exists: stream it
        // else: keep the procedural synth running
      });
    };

    // music-mapping-vol23/vol4: context -> track id (vols 2-4) via
    // CONTEXT_MUSIC_MAP. Unknown context = no-op (synth keeps playing).
    // Already playing that id = no-op (avoids restarting the crossfade).
    // Missing file = silent fallback (procedural synth keeps playing).
    api.playMusicForContext = function (context) {
      var id = CONTEXT_MUSIC_MAP[context];
      if (!id) return; // unknown context: keep the procedural synth running
      if (currentMusicId === id) return; // same track already owns the mix
      probeMusic(id, function (ok) {
        if (ok) api.playMusic(id);
        // else: keep the procedural synth running (silent fallback)
      });
    };
    api._currentMusicId = function () { return currentMusicId; }; // test hook

    api.stopMusicFile = function () {
      musicFileMode = false;
      currentMusicId = null; // music-mapping-vol23: hand the mix back to the synth
      try { if (musicSlotA) musicSlotA.pause(); } catch (e) {}
      try { if (musicSlotB) musicSlotB.pause(); } catch (e2) {}
      try { SF.Music.kick(); } catch (e3) {}
    };

    api.sfx = function (id) {
      var st = sfxFiles[id];
      if (st && st !== 'pending') { playSfxBuffer(st); return; } // file path
      if (sfxMissing[id]) { synthFallback(id); return; }        // known-bad file
      loadSfxFile(id);          // probe in background...
      synthFallback(id);        // ...and play the synth NOW (zero latency, always works)
    };
    api.sfxReset = function () { // test hook: clear the file cache (+ fallback counters)
      sfxFiles = {}; sfxMissing = {}; synthFallbackCounts = {};
    };
    api._synthFallbackCount = function (id) { // test hook: synthFallback fires per id
      return synthFallbackCounts[id] || 0;
    };
    api._sfxState = function (id) { // test hook: 'pending' | 'ready' | 'missing'
      if (sfxFiles[id] && sfxFiles[id] !== 'pending') return 'ready';
      if (sfxFiles[id] === 'pending') return 'pending';
      if (sfxMissing[id]) return 'missing';
      return 'unknown';
    };

    /* ---- sfx-route-internals: route synth methods through the OGG bank ----
     * Every synth SFX method is wrapped in a router that keeps its ORIGINAL
     * throttle gate, then calls api.sfx(id): banked file via the buffer-cache
     * path first, procedural synth fallback when the file is missing or
     * undecodable (game never breaks on absent assets). No signature changes;
     * call sites are untouched. miningTick is alias-only (no same-named
     * method): callers reach it via SF.Audio.sfx('miningTick'). */
    var ROUTE_GATES = { // original throttle ms per routed id (unchanged values)
      laser: 50, enemyLaser: 70, missile: 120, explosion: 90, hit: 60,
      shieldHit: 60, pickup: 60, credit: 60, deny: 120, ui: 40, uiBack: 40,
      railgun: 90, repeater: 50, flak: 90, beam: 70, torpedo: 140, emp: 140,
      mine: 120, starfall: 120, dialogue: 90, alert: 400, hullAlarm: 700
      // every other routed id had no gate: routes ungated, exactly as before
    };
    Object.keys(SFX_FALLBACK).forEach(function (id) {
      var m = SFX_FALLBACK[id];
      if (typeof api[m] !== 'function') return;       // alias-only id, nothing to wrap
      if (!_origSynth[m]) _origSynth[m] = api[m];     // save the real synth, pre-wrap
      if (typeof api[id] !== 'function' || api[id]._routed) return;
      (function (iid, ms) {
        var r = function () {
          if (ms > 0 && !gate('rt:' + iid, ms)) return;
          api.sfx(iid);
        };
        r._routed = true;
        api[iid] = r;
      })(id, ROUTE_GATES[id] || 0);
    });

    api.voice = function (id) {
      var url = ASSET_BASE + 'audio/voice/' + id + '.ogg';
      SF.Audio.unlock();
      try { if (voiceEl) voiceEl.pause(); } catch (e) {}
      var el = new Audio(url);
      voiceEl = el;
      var ducked = false;
      function unduck() { if (ducked) { ducked = false; api._duck(1); } }
      el.addEventListener('canplay', function onCan() {
        el.removeEventListener('canplay', onCan);
        ducked = true; api._duck(0.25);
        try { el.volume = settings.muted ? 0 : 1; el.play().catch(function () { unduck(); synthFallback('dialogue'); }); }
        catch (e2) { unduck(); synthFallback('dialogue'); }
      }, { once: true });
      el.addEventListener('error', function () { synthFallback('dialogue'); }, { once: true });
      el.addEventListener('ended', unduck, { once: true });
      return el;
    };

    // keep streamed music in step with the volume/mute UI
    (function hookMusicVolume() {
      var orig = api.setVolume;
      api.setVolume = function (kind, v) {
        var r = orig.call(api, kind, v);
        applyMusicVolume();
        return r;
      };
      var origT = api.toggleMute;
      api.toggleMute = function () {
        var r = origT.call(api);
        applyMusicVolume();
        return r;
      };
    })();

    /* route a weapon id to its firing sound (fallback: laser / missile) */
  return api;
})();

/* ---------------- SF.Music: procedural per-system music ----------------
 * Generative themes, lookahead scheduler, crossfade on game-state change.
 * Self-driving: reads SF.Game.state / SF.Game.systemId. Starts after the
 * first unlock() (AudioContext running). Zero assets.
 */
SF.Music = (function () {
  // scale = semitone offsets from root; chords = scale-degree rows per bar
  var THEMES = {
    title:  { root: 110.0, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [4, 1, 3], [2, 4, 0], [3, 0, 2]],
              step: 0.46, padEvery: 16, arpPat: [0, null, 2, null, 4, null, 2, null], bassEvery: 8, drums: false, cutoff: 900,  sparkle: 0.10 },
    solace: { root: 130.81, scale: [0, 2, 4, 6, 7, 9, 11], chords: [[0, 2, 4], [4, 1, 3], [5, 2, 4], [3, 0, 2]],
              step: 0.30, padEvery: 16, arpPat: [0, 2, 4, 2, 5, 4, 2, 1], bassEvery: 8, drums: false, cutoff: 1600, sparkle: 0.22 },
    drift:  { root: 146.83, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [2, 4, 1], [4, 1, 3], [3, 0, 4]],
              step: 0.40, padEvery: 16, arpPat: [0, null, null, 2, null, 4, null, null], bassEvery: 8, drums: false, cutoff: 700,  sparkle: 0.12 },
    ember:  { root: 164.81, scale: [0, 1, 5, 7, 8], chords: [[0, 2, 3], [1, 3, 0], [0, 2, 3], [4, 2, 0]],
              step: 0.21, padEvery: 16, arpPat: [0, 0, 2, 0, 3, 0, 2, 1], bassEvery: 4, drums: true, cutoff: 2400,  sparkle: 0.30 },
    docked: { root: 174.61, scale: [0, 2, 4, 7, 9], chords: [[0, 2, 4], [2, 4, 1], [3, 1, 4], [0, 3, 2]],
              step: 0.44, padEvery: 16, arpPat: [0, null, 2, null, 4, null, 3, null], bassEvery: 8, drums: false, cutoff: 1100, sparkle: 0.15 }
  };

  var cur = null, step = 0, nextT = 0, fading = false, kicked = false;
  var lastState = null;
  var _duck = 1; // asset-loader-infra: voice-line duck multiplier (0.25 while a voice line plays)

  function semi(root, n) { return root * Math.pow(2, n / 12); }

  function gameState() {
    try {
      if (window.SF && SF.Game) return { state: SF.Game.state, system: SF.Game.systemId };
    } catch (e) {}
    return { state: 'TITLE', system: 'solace' };
  }

  function themeFor(state, systemId) {
    if (state === 'PLAYING' || state === 'BOARDING') {
      return THEMES[systemId] ? systemId : 'solace';
    }
    if (state === 'DOCKED' || state === 'STARMAP') return 'docked';
    return 'title'; // TITLE, GAMEOVER, unknown
  }

  function combatActive() {
    try {
      if (window.SF && SF.Enemies) {
        var L = SF.Enemies.list;
        var n = (typeof L === 'function') ? L().length : (L && L.length) || 0;
        return n >= 3;
      }
    } catch (e) {}
    return false;
  }

  function mnote(freq, t0, dur, type, peak, cutoff, attack) {
    try {
      var c = SF.Audio._ctx(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, freq), t0);
      var node = o;
      if (cutoff) {
        var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
        o.connect(f); node = f;
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (attack || 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      node.connect(g); g.connect(musicBusNode(c));
      o.start(t0); o.stop(t0 + dur + 0.1);
    } catch (e) { /* ignore */ }
  }

  var _musicBus = null;
  function musicBusNode(c) {
    // musicBus is module-private in SF.Audio; reach it via a dedicated gain we own.
    if (!_musicBus) { _musicBus = c.createGain(); _musicBus.connect(c.destination); }
    return _musicBus;
  }

  function mnoise(t0, dur, peak, hp) {
    try {
      var c = SF.Audio._ctx(); if (!c) return;
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = c.createBufferSource(); src.buffer = buf;
      var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 6000;
      var g = c.createGain();
      g.gain.setValueAtTime(peak, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(musicBusNode(c));
      src.start(t0);
    } catch (e) { /* ignore */ }
  }

  function playStep(themeId, s, t0) {
    var th = THEMES[themeId]; if (!th) return;
    var bar = Math.floor(s / th.padEvery) % th.chords.length;
    var chord = th.chords[bar];
    var in16 = s % 16;

    // pad: chord tones, long attack, every padEvery steps
    if (s % th.padEvery === 0) {
      var padDur = th.step * th.padEvery * 1.1;
      for (var i = 0; i < chord.length; i++) {
        var f = semi(th.root, th.scale[chord[i] % th.scale.length]);
        mnote(f, t0, padDur, 'triangle', 0.055, th.cutoff, 0.9);
        mnote(f * 1.003, t0, padDur, 'sine', 0.045, th.cutoff, 1.1);
      }
    }
    // arp
    var deg = th.arpPat[s % th.arpPat.length];
    if (deg !== null && deg !== undefined) {
      var af = semi(th.root * 2, th.scale[deg % th.scale.length]);
      mnote(af, t0, th.step * 2.2, 'square', 0.028, th.cutoff * 1.6, 0.008);
    }
    // sparkle: rare high pluck
    if (Math.random() < th.sparkle && deg !== null && deg !== undefined) {
      mnote(semi(th.root * 4, th.scale[(deg + 2) % th.scale.length]), t0 + th.step / 2, th.step * 1.5, 'sine', 0.02, 6000, 0.01);
    }
    // bass
    if (s % th.bassEvery === 0) {
      var bf = semi(th.root / 2, th.scale[chord[0] % th.scale.length]);
      mnote(bf, t0, th.step * th.bassEvery * 0.9, 'sine', 0.075, 500, 0.02);
      mnote(bf, t0, th.step * th.bassEvery * 0.9, 'sawtooth', 0.02, 400, 0.02);
    }
    // drums: theme drums, or combat layer on any PLAYING theme
    var drums = th.drums || combatActive();
    if (drums) {
      if (in16 % 4 === 0) { // kick
        try {
          var c = SF.Audio._ctx(); if (c) {
            var o = c.createOscillator(), g = c.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(120, t0);
            o.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
            g.gain.setValueAtTime(0.16, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
            o.connect(g); g.connect(musicBusNode(c));
            o.start(t0); o.stop(t0 + 0.2);
          }
        } catch (e) {}
      }
      if (in16 % 2 === 1) mnoise(t0, 0.05, 0.035); // hat
    }
  }

  function switchTheme(want) {
    if (want === cur || fading) { cur = want; return; }
    var c = SF.Audio._ctx(); if (!c) { cur = want; step = 0; return; }
    fading = true;
    try {
      var g = musicBusNode(c).gain, t = c.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(0.0001, t + 0.7);
    } catch (e) {}
    setTimeout(function () {
      try {
        cur = want; step = 0;
        var c2 = SF.Audio._ctx();
        if (c2) {
          var g2 = musicBusNode(c2).gain, t2 = c2.currentTime;
          var lvl = SF.Audio.isMuted() ? 0.0001 : Math.max(0.0001, SF.Audio.getVolume('music') * 0.9);
          g2.cancelScheduledValues(t2);
          g2.setValueAtTime(0.0001, t2);
          g2.exponentialRampToValueAtTime(lvl, t2 + 1.2);
          nextT = c2.currentTime + 0.05;
        }
      } catch (e2) {}
      fading = false;
    }, 750);
  }

  function tick() {
    // asset-loader-infra: while a streamed music file is active, the
    // procedural scheduler stays silent (SF.Audio.playMusic owns the mix).
    try { if (window.SF && SF.Audio && SF.Audio._fileModeActive && SF.Audio._fileModeActive()) return; }
    catch (e) {}
    var c = SF.Audio._ctx();
    if (!c || c.state !== 'running') return;
    if (_duck !== 1) {
      try {
        var bus = musicBusNode(c);
        var lvl = SF.Audio.isMuted() ? 0.0001 : Math.max(0.0001, SF.Audio.getVolume('music') * 0.9 * _duck);
        bus.gain.setTargetAtTime(lvl, c.currentTime, 0.2);
      } catch (e2) {}
    }
    var gs = gameState();
    var want = themeFor(gs.state, gs.system);
    // auto-close the settings overlay on game-state change (main.js showOnly
    // doesn't know about #overlay-settings; we keep it consistent ourselves)
    if (lastState !== null && gs.state !== lastState) {
      try {
        var ov = document.getElementById('overlay-settings');
        if (ov) ov.classList.add('hidden');
      } catch (e) {}
    }
    lastState = gs.state;
    if (want !== cur) switchTheme(want);
    if (fading) return;
    if (SF.Audio.isMuted() || SF.Audio.getVolume('music') <= 0.01 || SF.Audio.getVolume('master') <= 0.01) return;
    if (!cur) { cur = want; step = 0; }
    var ahead = c.currentTime + 0.4;
    if (nextT < c.currentTime - 1 || nextT === 0) nextT = c.currentTime + 0.05;
    var guard = 0;
    while (nextT < ahead && guard++ < 64) {
      playStep(cur, step, nextT);
      step++;
      nextT += THEMES[cur].step;
    }
  }

  // scheduler runs always; tick() no-ops until unlock() creates the context
  setInterval(tick, 120);

  return {
    kick: function () { kicked = true; tick(); },
    current: function () { return cur; },
    themeFor: themeFor, // test hook: themeFor(state, systemId)
    themes: function () { return Object.keys(THEMES); },
    _setDuck: function (f) { _duck = (typeof f === 'number') ? f : 1; } // asset-loader-infra: voice ducking
  };
})();

/* ---------------- settings overlay wiring (index.html #overlay-settings) ---- */
(function audioSettingsUI() {
  function $(id) { return document.getElementById(id); }

  function paint() {
    var s = SF.Audio.settings();
    var m = $('set-master'), x = $('set-sfx'), u = $('set-music');
    if (m) { m.value = Math.round(s.master * 100); $('set-master-val').textContent = m.value; }
    if (x) { x.value = Math.round(s.sfx * 100); $('set-sfx-val').textContent = x.value; }
    if (u) { u.value = Math.round(s.music * 100); $('set-music-val').textContent = u.value; }
    var mb = $('set-mute');
    if (mb) mb.textContent = s.muted ? '🔇 sound off' : '🔊 sound on';
  }

  function open() {
    var ov = $('overlay-settings');
    if (!ov) return;
    paint();
    ov.classList.remove('hidden');
    SF.Audio.unlock(); SF.Audio.ui();
  }
  function close() {
    var ov = $('overlay-settings');
    if (ov) ov.classList.add('hidden');
    SF.Audio.ui();
  }

  var bHud = $('btn-settings'), bTitle = $('btn-title-settings');
  if (!bHud && !bTitle) return; // markup not present (older index.html)
  if (bHud) bHud.addEventListener('click', open);
  if (bTitle) bTitle.addEventListener('click', open);
  var sc = $('set-close'); if (sc) sc.addEventListener('click', close);

  [['set-master', 'master'], ['set-sfx', 'sfx'], ['set-music', 'music']].forEach(function (pair) {
    var elx = $(pair[0]);
    if (!elx) return;
    elx.addEventListener('input', function () {
      SF.Audio.unlock();
      SF.Audio.setVolume(pair[1], elx.value / 100);
      // audible feedback while dragging the sfx slider
      if (pair[1] === 'sfx') SF.Audio.ui();
    });
    elx.addEventListener('change', function () { SF.Audio.unlock(); });
  });

  var mb = $('set-mute');
  if (mb) mb.addEventListener('click', function () { SF.Audio.unlock(); SF.Audio.toggleMute(); });
  var rs = $('set-reset');
  if (rs) rs.addEventListener('click', function () { SF.Audio.unlock(); SF.Audio.resetVolumes(); SF.Audio.ui(); });

  // keep the overlay labels in sync when mute changes via HUD/title buttons
  SF.Audio.onSettingsChange(paint);
  paint();
})();

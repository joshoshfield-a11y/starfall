/* ============================================================
 * STARFALL — story-campaign phase: Story Campaign
 *
 * SF.Story: the story campaign system.
 *  - Intro sequence: new-game cinematic overlay (auto-advance + skip).
 *  - 'The Fall': multi-stage main quest chain with objectives,
 *    waypoints and scripted encounters.
 *  - 3 faction story arcs (Solar Compact / Free Drifters / Ember Pact),
 *    unlocked at standing >= 25 via faction NPCs.
 *  - Karma-gated finale: the final branch depends on the captain's
 *    karma (good / neutral / evil).
 *
 * Hooks (wrapping, not editing): SF.Quests.onKill is wrapped so story
 * kills are counted; SF.NPCs.renderCantina is wrapped to add the story
 * NPC rows; SF.NPCs.talk routes the story NPC ids.
 *
 * Story progress persists on the player blob as P.story (save v7,
 * migrateV6). Progress never blocks quest-board/escort/kill contracts.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function ss() {
    var st = SF.Player.storyState;
    if (!st) { st = defaultStory(); SF.Player.storyState = st; }
    return st;
  }

  function defaultStory() {
    return {
      introSeen: false,
      fall: 0,          // 0 = not started, 1..6 = stages, 7 = chain resolved (finale offered/done)
      fallKills: 0,     // scripted-encounter kill counter for the active stage
      arcs: { compact: 0, drifters: 0, ember: 0 },   // 0 = locked/not started .. 4 = done
      arcKills: {},     // kill counters per arc
      peace: { compact: false, drifters: false, ember: false }, // neutral-finale visits
      finale: null,     // null | 'good' | 'neutral' | 'evil'
      finaleDone: false,
      finaleKills: 0,
      waypoint: null,   // {systemId, x, y, label}
      lastOre: 0,
      mined: 0          // ore collected since tracking began (per save)
    };
  }
  SF.StoryDefault = defaultStory;

  /* ============================================================
   * VOICE BARKS (voice-barks-wiring-retry)
   *
   * Wires voice-pack-1's campaign barks into the story. playBarks(ids)
   * plays SF.Audio.voice(id) for each id in sequence (guarded, never
   * throws) and shows the line's text as a subtitle caption for its
   * duration. A new playBarks call interrupts any in-flight sequence.
   * Save-neutral: no new persisted state, no version bump.
   * ============================================================ */

  var VOICE_BARKS = {
    "intro_01": {"n": "ASH", "c": "#7fd4ff", "t": "The sky over Solace burned red the night the relay went silent.", "d": 3.43},
    "intro_02a": {"n": "ASH", "c": "#7fd4ff", "t": "Three powers hold the frontier. The Compact keeps the lanes.", "d": 3.87},
    "intro_02b": {"n": "ASH", "c": "#7fd4ff", "t": "The Drifters keep their freedom. The Pact keeps a list of the dead.", "d": 3.96},
    "intro_03": {"n": "ASH", "c": "#7fd4ff", "t": "You were nobody. A rusted fighter, an empty hold, and a debt you never signed.", "d": 5.16},
    "intro_04": {"n": "ASH", "c": "#7fd4ff", "t": "Then the signal came. A wreck tumbling out of the black, broadcasting your name on a dead channel.", "d": 5.66},
    "intro_05": {"n": "ASH", "c": "#7fd4ff", "t": "They call it the Fall. Find the wreck. Learn what fell. Choose who you become.", "d": 5.1},
    "fall_01": {"n": "ASH", "c": "#7fd4ff", "t": "The Meridian fell out of the black three weeks back. It has been calling your name ever since.", "d": 5.14},
    "fall_02": {"n": "ASH", "c": "#7fd4ff", "t": "The wreck's last signal is marked on your scope. Fly careful. Shoot straighter.", "d": 4.94},
    "fall_03": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Contact! Wreck-rats are guarding the signal source. Weapons free!", "d": 3.82},
    "fall_04": {"n": "ASH", "c": "#7fd4ff", "t": "Signal decoded. The trail runs through the Drift. Come back to Haven Dock.", "d": 4.7},
    "fall_05a": {"n": "ASH", "c": "#7fd4ff", "t": "A Drifter courier was paid to move Meridian salvage, then silenced.", "d": 4.15},
    "fall_05b": {"n": "ASH", "c": "#7fd4ff", "t": "Ember scouts did it, if the transponder ghosts are honest.", "d": 3.54},
    "fall_06": {"n": "BROKER", "c": "#ffd23f", "t": "The patrol route costs two hundred credits. Or you can lean on me. It won't be pretty.", "d": 4.38},
    "fall_07": {"n": "ASH", "c": "#7fd4ff", "t": "The courier's last known lane is marked. Someone out there is killing couriers to keep a secret.", "d": 5.33},
    "fall_08": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Ember scouts on the lane! They're moving to cut you off. Break them!", "d": 3.32},
    "fall_09": {"n": "ASH", "c": "#7fd4ff", "t": "The scouts carried Ember cipher keys. Military grade. The Pact burned a whole colony to bury this.", "d": 6.45},
    "fall_10": {"n": "ASH", "c": "#7fd4ff", "t": "The Compact will pay for those cipher keys. Or take the Pact's deal. Your call, captain.", "d": 6.02},
    "fall_11": {"n": "ASH", "c": "#7fd4ff", "t": "The colony site is marked. Go see what they burned. Bring guns.", "d": 4.48},
    "fall_12": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Burned colony perimeter ahead. Pact guns are up. Stay low and hit hard!", "d": 3.99},
    "fall_13": {"n": "ASH", "c": "#7fd4ff", "t": "The colony wasn't burned for cargo. It was burned for a relay. A pre-collapse beacon the Meridian was hauling.", "d": 6.56},
    "fall_14": {"n": "ASH", "c": "#7fd4ff", "t": "The relay's core is cracked. I need ten ore to machine a new housing before the signal dies.", "d": 5.64},
    "fall_15": {"n": "RELAY", "c": "#b48cff", "t": "It's alive. Listen. Can you hear it singing?", "d": 3.22},
    "fall_16": {"n": "ASH", "c": "#7fd4ff", "t": "The relay will choose its keeper by the shape of their soul. Your karma precedes you, captain.", "d": 5.47},
    "fall_17": {"n": "ASH", "c": "#7fd4ff", "t": "This is the choice the Fall was always about. There is no going back.", "d": 3.8},
    "fall_18": {"n": "ASH", "c": "#7fd4ff", "t": "Fly to the relay beacon in Solace. Hold the line. The frontier is watching.", "d": 4.91},
    "fall_19": {"n": "ASH", "c": "#7fd4ff", "t": "Fly to the relay beacon. The Compact guard won't hand it over. Take it.", "d": 4.7},
    "fall_20": {"n": "ASH", "c": "#7fd4ff", "t": "No armies. Just you and your word. Win over the envoys, one by one.", "d": 5.2},
    "fall_21": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Ember strike team inbound! Hold the relay, captain. Hold it!", "d": 3.57},
    "fall_22": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Compact interceptors! They won't surrender the relay. Make them.", "d": 3.57},
    "fall_23": {"n": "RELAY", "c": "#b48cff", "t": "The relay hums with your name on it. Finish what you started.", "d": 3.47},
    "fall_24": {"n": "ASH", "c": "#7fd4ff", "t": "Whatever comes next, captain. It's yours.", "d": 3.3},
    "compact_arc_01": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "The Compact keeps the lanes because someone has to. Pirates don't fear speeches.", "d": 4.07},
    "compact_arc_02": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "Your standing precedes you, captain. The Compact has work for someone with your reputation.", "d": 4.12},
    "compact_arc_03": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "Three pirates down. The lane breathes easier. The Order remembers.", "d": 3.77},
    "compact_arc_04": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "A Compact freighter is shadowed by raiders. Break the pack off its tail.", "d": 3.77},
    "compact_arc_05": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Escort intercept! Raider pack on the freighter. Kill them all!", "d": 3.44},
    "compact_arc_06": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "Order's Shield is complete. The Compact pays its debts, in credits and in standing.", "d": 4.12},
    "drifter_arc_01": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "Freedom has a ledger, captain. Twelve ore for the refit fund. The Drift remembers its friends.", "d": 5.56},
    "drifter_arc_02": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "Free skies don't stay free by themselves. There's a raider nest on the lane. Clear it.", "d": 5.29},
    "drifter_arc_03": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Raider nest ahead! Drones and raiders, mixed. Burn it down!", "d": 3.42},
    "drifter_arc_04": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "The nest is quiet. The Drift breathes free. Good flying, captain.", "d": 4.78},
    "drifter_arc_05": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "Report back to me at Haven Dock when the work is done.", "d": 3.07},
    "drifter_arc_06": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "Free Skies is complete. The Drifters won't forget this one.", "d": 3.59},
    "ember_arc_01": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "Fire remembers, captain. Prove yours. Destroy a Compact patrol.", "d": 4.87},
    "ember_arc_02": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Compact patrol on scope! Take them down. The Pact rewards the bold.", "d": 3.86},
    "ember_arc_03": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "The patrol burns. Now feed the war foundry. Eight ore from the Solace belt.", "d": 4.97},
    "ember_arc_04": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "The foundry drinks deep. You have the Pact's attention now.", "d": 3.66},
    "ember_arc_05": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "Report to me at Haven Dock. The Pact does not wait long.", "d": 3.44},
    "ember_arc_06": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "Burn Bright is complete. The Pact pays its debts in fire.", "d": 3.71},
    "finale_good_01": {"n": "ASH", "c": "#7fd4ff", "t": "Your name opens doors. The Compact will stand with you. Hold the relay.", "d": 4.83},
    "finale_good_02": {"n": "HOSTILES", "c": "#ff5a5a", "t": "Strike team breaking through! The relay must not fall. Hold the line!", "d": 3.67},
    "finale_good_03": {"n": "ASH", "c": "#7fd4ff", "t": "The Fall is resolved in light. The frontier hears the truth now.", "d": 3.93},
    "finale_evil_01": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "Your reputation walks in before you do. The relay is yours for the taking.", "d": 4.46},
    "finale_evil_02": {"n": "HOSTILES", "c": "#ff5a5a", "t": "The guard is down! Seize the relay! Everything it hears is yours!", "d": 3.83},
    "finale_evil_03": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "The Fall is resolved in fire. The Pact honors its own.", "d": 3.71},
    "finale_neutral_01": {"n": "MARSHAL REYES", "c": "#7dff9a", "t": "The Compact will respect a neutral relay. You have my word.", "d": 3.0},
    "finale_neutral_02": {"n": "CAPTAIN KADE", "c": "#ffb35a", "t": "A free channel nobody owns? That's the Drifter dream, captain. We're in.", "d": 4.95},
    "finale_neutral_03": {"n": "HERALD SORROW", "c": "#ff7a4d", "t": "The Pact does not share fire. But we will not burn this one. You have our word.", "d": 5.09},
    "finale_neutral_04": {"n": "ASH", "c": "#7fd4ff", "t": "All three envoys stand with you. The relay is neutral ground. The Fall is resolved in balance.", "d": 6.14}
  };

  var barkQueue = [];
  var barkTimer = null;
  var barkGen = 0;      // beta-intro: stale 'ended' listeners from an
  var barkOnDone = null; // interrupted sequence must never fire a callback
  var captionEl = null;

  function ensureCaption() {
    if (captionEl) return captionEl;
    var el = document.createElement('div');
    el.id = 'sf-voice-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);' +
      'max-width:min(86vw,640px);padding:10px 14px;border-radius:10px;' +
      'background:rgba(4,8,18,.82);border:1px solid rgba(127,212,255,.35);' +
      'color:#eaf4ff;font:15px/1.45 system-ui,sans-serif;text-align:center;' +
      'z-index:9999;pointer-events:none;display:none;text-shadow:0 1px 2px #000;';
    document.body.appendChild(el);
    captionEl = el;
    return el;
  }

  function hideCaption() {
    if (captionEl) captionEl.style.display = 'none';
  }

  function stopBarks() {
    barkQueue = [];
    barkGen++; // orphan any in-flight 'ended' listener (see pumpBark)
    barkOnDone = null;
    if (barkTimer) { clearTimeout(barkTimer); barkTimer = null; }
    hideCaption();
  }

  /* beta-intro: a bark step advances on the voice clip's OWN 'ended'
   * event when one fires, so a slide/line is never cut short by the
   * load latency between the voice() call and actual playback start
   * (the old timer ran from call time, so every line lost its latency
   * off the tail). When no 'ended' ever arrives (playback blocked,
   * file missing, synth fallback), the declared-duration timer plus a
   * generous margin still steps the sequence — never a soft-lock.
   * The timer is a fallback, not the schedule: on a normally playing
   * clip 'ended' (latency + duration) always lands before it. */
  var BARK_FALLBACK_EXTRA_MS = 2500;

  function pumpBark() {
    barkTimer = null;
    if (!barkQueue.length) {
      hideCaption();
      var cb = barkOnDone; barkOnDone = null;
      if (cb) { try { cb(); } catch (err) { /* callback must never break the story */ } }
      return;
    }
    var id = barkQueue.shift();
    var b = VOICE_BARKS[id];
    var voiceEl = null;
    try {
      if (b && SF.Audio && SF.Audio.voice) voiceEl = SF.Audio.voice(id);
    } catch (err) { /* voice must never break the story */ }
    if (b) {
      var el = ensureCaption();
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:' + b.c +
        ';margin-bottom:4px;font-weight:700;';
      sp.textContent = b.n;
      var tx = document.createElement('div');
      tx.textContent = b.t;
      el.appendChild(sp); el.appendChild(tx);
      el.style.display = 'block';
      var gen = barkGen;
      var stepped = false;
      var step = function () {
        if (stepped || gen !== barkGen) return;
        stepped = true;
        if (barkTimer) { clearTimeout(barkTimer); barkTimer = null; }
        pumpBark();
      };
      barkTimer = setTimeout(step, Math.max(1200, b.d * 1000 + BARK_FALLBACK_EXTRA_MS));
      if (voiceEl && typeof voiceEl.addEventListener === 'function') {
        try { voiceEl.addEventListener('ended', step, { once: true }); } catch (err) {}
      }
    } else {
      pumpBark(); // unknown id: skip ahead
    }
  }

  // Replace any in-flight bark sequence with ids (interrupt-safe).
  // onDone (optional) fires exactly once when the sequence drains.
  function playBarks(ids, onDone) {
    if (barkTimer) { clearTimeout(barkTimer); barkTimer = null; }
    barkGen++;
    barkOnDone = (typeof onDone === 'function') ? onDone : null;
    barkQueue = (ids || []).slice();
    pumpBark();
  }
  function playBark(id) { playBarks([id]); }

  var BEAT_BARKS = [
    ['intro_01'],
    ['intro_02a', 'intro_02b'],
    ['intro_03'],
    ['intro_04'],
    ['intro_05']
  ];

  var ARC_BARK_PREFIX = { compact: 'compact', drifters: 'drifter', ember: 'ember' };
  function arcBark(f, n) { return ARC_BARK_PREFIX[f] + '_arc_' + (n < 10 ? '0' + n : '' + n); }


  /* ---------------- waypoints ---------------- */

  function setWaypoint(systemId, x, y, label) {
    ss().waypoint = { systemId: systemId, x: x, y: y, label: label };
  }
  function clearWaypoint() { ss().waypoint = null; }

  function sysName(id) {
    return (SF.SYSTEM_BY_ID[id] && SF.SYSTEM_BY_ID[id].name) || id;
  }

  /* ---------------- scripted spawns ---------------- */

  function sysMul(systemId) {
    var s = SF.SYSTEM_BY_ID[systemId];
    return s ? s.enemyMul : 1;
  }

  // Spawn a story-tagged wave around the player. Kills are tracked by tag.
  // faction: optional faction id so patrol-kill consequences apply (evil paths).
  function spawnStoryWave(systemId, types, tag, faction) {
    var p = SF.Player;
    var mul = sysMul(systemId);
    types.forEach(function (t, i) {
      var a = Math.random() * Math.PI * 2;
      var d = 560 + i * 90;
      var opts = { storyOid: tag };
      if (faction) opts.faction = faction;
      SF.Enemies.spawn(t, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, mul, opts);
    });
  }

  function storyKillsLeft(tag) {
    return SF.Enemies.list.filter(function (e) { return e.storyOid === tag; }).length;
  }

  /* ---------------- intro sequence ---------------- */

  var BEATS = [
    'The sky over Solace burned the color of a dying sun the night the relay went silent.',
    'Three powers hold the frontier now. The Solar Compact keeps the lanes. The Free Drifters keep their freedom. The Ember Pact keeps a list of the dead.',
    'You were nobody. A rusted fighter, an empty hold, and a debt you never signed.',
    'Then the signal came. A wreck tumbling out of the black, broadcasting your name on a dead channel.',
    'They call it THE FALL.\n\nFind the wreck. Learn what fell.\nChoose who you become.'
  ];
  /* beta-intro: the fixed 6500 ms slide interval is gone. It was the
   * race: beat 2 narrates 3.87 + 3.96 = 7.83 s but the slide advanced
   * at 6.50 s, cutting the second line ~1.34 s early (and every line
   * lost its audio-load latency off the tail, since the old bark
   * timers ran from call time). Slides now advance on narration
   * completion (the beat's bark sequence draining, see pumpBark),
   * plus a short gap so the cut does not feel abrupt. */
  var INTRO_BEAT_GAP_MS = 600;

  var introTimer = null; // beat-gap setTimeout handle (was an interval)
  var introIdx = 0;
  var introActive = false;

  function paintBeat() {
    var el = $('intro-text');
    if (!el) return;
    el.textContent = BEATS[introIdx];
    el.classList.remove('intro-fade');
    void el.offsetWidth; // restart fade animation
    el.classList.add('intro-fade');
    var dots = $('intro-dots');
    if (dots) {
      dots.textContent = BEATS.map(function (_, i) {
        return i === introIdx ? '●' : '○';
      }).join(' ');
    }
    /* twelve-hour-wave1: state the intro's own length and what follows it,
     * so a first NEW GAME no longer stacks an unstated intro + an unstated
     * walkthrough. Total first-time setup: ~30 s intro + ~2 min walkthrough,
     * both skippable (SKIP here, SKIP on the walkthrough card). */
    var prog = $('intro-progress');
    if (prog) {
      prog.textContent = 'STORY INTRO \u00B7 BEAT ' + (introIdx + 1) + ' OF ' + BEATS.length +
        ' \u00B7 ~30 SEC \u00B7 FIRST-FLIGHT WALKTHROUGH FOLLOWS (~2 MIN)';
    }
    var next = $('btn-intro-next');
    if (next) next.classList.toggle('hidden', introIdx < BEATS.length - 1);
    // beta-intro: advance on narration completion, never on a clock.
    // The last beat never auto-advances (BEGIN waits for the player);
    // SKIP (finishIntro) always works, mid-narration included.
    var beatIdx = introIdx;
    if (beatIdx < BEATS.length - 1) {
      playBarks(BEAT_BARKS[beatIdx], function () {
        if (!introActive || introIdx !== beatIdx) return;
        stopIntroTimer();
        introTimer = setTimeout(function () {
          introTimer = null;
          if (!introActive || introIdx !== beatIdx) return;
          introIdx++;
          paintBeat();
          if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        }, INTRO_BEAT_GAP_MS);
      });
    } else {
      playBarks(BEAT_BARKS[beatIdx]);
    }
  }

  function stopIntroTimer() {
    if (introTimer) { clearTimeout(introTimer); introTimer = null; }
  }

  function finishIntro() {
    introActive = false;
    stopIntroTimer();
    stopBarks();
    ss().introSeen = true;
    if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('intro'); } catch (e) {} }
    SF.Game.hideOverlay('overlay-intro');
    SF.Game.setState('PLAYING');
    SF.HUD.toast('Welcome to Solace. Mine, fight, dock at Haven.');
    if (SF.Save) SF.Save.save();
  }

  function playIntro() {
    introActive = true;
    introIdx = 0;
    SF.Game.showOverlay('overlay-intro');
    stopIntroTimer();
    paintBeat(); // paintBeat schedules the next beat on narration completion
  }

  function wireIntro() {
    var skip = $('btn-intro-skip');
    var next = $('btn-intro-next');
    if (skip) skip.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      finishIntro();
    });
    if (next) next.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      finishIntro();
    });
  }

  /* ============================================================
   * THE FALL — main quest chain
   *
   * Stages: 0 not started; 1 signal/waypoint+ambush; 2 courier choice;
   * 3 ember bargain; 4 ore delivery; 5 relay reveal; 6 finale mission;
   * 7 chain complete.
   * ============================================================ */

  var FALL_WAYPOINTS = {
    wreck:  { systemId: 'solace', x: 900,  y: 900,  label: 'The Fall: investigate the wreck signal' },
    drift:  { systemId: 'drift',  x: 3300, y: 900,  label: 'The Fall: the courier runs the Drift' },
    ember:  { systemId: 'ember',  x: 2100, y: 3100, label: 'The Fall: burned colony in Ember' },
    finGood:{ systemId: 'solace', x: 3000, y: 1200, label: 'FINALE: defend the relay' },
    finEvil:{ systemId: 'solace', x: 1200, y: 3200, label: 'FINALE: seize the relay' }
  };

  var ARC_WAYPOINTS = {
    solace: { x: 3000, y: 1200 },
    drift:  { x: 3300, y: 900 },
    ember:  { x: 2100, y: 3100 }
  };

  var FALL_TITLES = {
    0: 'The Fall — unstarted',
    1: 'The Fall I — Signal in the Static',
    2: 'The Fall II — The Courier\u2019s Price',
    3: 'The Fall III — Ember\u2019s Bargain',
    4: 'The Fall IV — What Fell',
    5: 'The Fall V — The Relay',
    6: 'The Fall VI — Finale',
    7: 'The Fall — resolved'
  };

  function fallTitle() { return FALL_TITLES[ss().fall] || FALL_TITLES[0]; }

  function fallStart() {
    var s = ss();
    s.fall = 1;
    s.fallKills = 0;
    var w = FALL_WAYPOINTS.wreck;
    setWaypoint(w.systemId, w.x, w.y, w.label);
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('New objective: ' + w.label);
    if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
  }

  // arrival at the active waypoint drives scripted encounters
  function checkArrival() {
    var s = ss();
    var wp = s.waypoint;
    if (!wp) return;
    if (SF.Game.systemId !== wp.systemId) return;
    var p = SF.Player;
    var dx = p.x - wp.x, dy = p.y - wp.y;
    if (dx * dx + dy * dy > 300 * 300) return;

    if (s.fall === 1 && wp.label === FALL_WAYPOINTS.wreck.label) {
      // scripted ambush at the wreck
      spawnStoryWave('solace', ['raider', 'raider', 'raider', 'raider'], 'fall1');
      playBark('fall_03');
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 Ambush! Wreck-rats guard the signal source.');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    } else if (s.fall === 2 && wp.label === FALL_WAYPOINTS.drift.label) {
      spawnStoryWave('drift', ['raider', 'raider', 'gunship'], 'fall2');
      playBark('fall_08');
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 Ember scouts ambush the courier lane!');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    } else if (s.fall === 3 && wp.label === FALL_WAYPOINTS.ember.label) {
      spawnStoryWave('ember', ['gunship', 'gunship', 'raider'], 'fall3');
      playBark('fall_12');
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 Burned colony perimeter — Pact guns up!');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    } else if (s.fall === 6 && s.finale === 'good' && wp.label === FALL_WAYPOINTS.finGood.label) {
      spawnStoryWave('solace', ['raider', 'raider', 'raider', 'gunship', 'gunship'], 'finG');
      playBarks(['fall_21', 'finale_good_02']);
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 Ember strike team inbound — HOLD THE RELAY!');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    } else if (s.fall === 6 && s.finale === 'evil' && wp.label === FALL_WAYPOINTS.finEvil.label) {
      spawnStoryWave('solace', ['gunship', 'gunship', 'gunship', 'raider'], 'finE', 'compact');
      playBarks(['fall_22', 'finale_evil_02']);
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 Compact interceptors — take the relay by force.');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    } else if (wp.label.indexOf('arcwp:') === 0) {
      // faction-arc objective waypoint: spawn the scripted wave on arrival
      var aparts = wp.label.split('|')[0].split(':'); // arcwp:<faction>:<stage>
      var af = aparts[1], astg = parseInt(aparts[2], 10);
      var adef = ARC_DEFS[af];
      if (adef && ss().arcs[af] === astg && adef.stages[astg] && adef.stages[astg].wave) {
        spawnStoryWave(wp.systemId, adef.stages[astg].wave, 'arc-' + af + '-' + astg,
          adef.stages[astg].patrol);
        playBark({ compact: 'compact_arc_05', drifters: 'drifter_arc_03',
          ember: 'ember_arc_02' }[af]);
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26a0 ' + adef.title + ' — hostiles at the objective!');
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      }
      clearWaypoint();
    }
  }

  function onKill(e) {
    var s = ss();
    // scripted encounter kills
    if (e && e.storyOid) {
      var tag = e.storyOid;
      if (tag === 'fall1' && s.fall === 1) {
        s.fallKills++;
        if (storyKillsLeft('fall1') === 0) {
          playBark('fall_04');
          s.fall = 2;
          if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('fall1'); } catch (e) {} }
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Signal decoded. Return to Ash at Haven Dock.');
          if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
        }
        return;
      }
      if (tag === 'fall2' && s.fall === 2) {
        s.fallKills++;
        if (storyKillsLeft('fall2') === 0) {
          playBark('fall_09');
          s.fall = 3;
          if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('fall2'); } catch (e) {} }
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Courier avenged. The trail points at Ember.');
          if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
        }
        return;
      }
      if (tag === 'fall3' && s.fall === 3) {
        s.fallKills++;
        if (storyKillsLeft('fall3') === 0) {
          playBark('fall_13');
          s.fall = 4;
          if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('fall3'); } catch (e) {} }
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Colony perimeter clear. Ash will want to hear this.');
          if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
        }
        return;
      }
      if (tag === 'finG' && s.fall === 6 && s.finale === 'good') {
        s.finaleKills++;
        if (storyKillsLeft('finG') === 0) finaleComplete('good');
        return;
      }
      if (tag === 'finE' && s.fall === 6 && s.finale === 'evil') {
        s.finaleKills++;
        // e.faction='compact' makes kill() apply the destroyPatrol consequences
        if (storyKillsLeft('finE') === 0) finaleComplete('evil');
        return;
      }
    }
    // faction arc kill objectives count any non-faction-pirate kill
    if (e && !e.faction && !e.storyOid) {
      arcKill('compact', 3);   // Order's Shield I: kill 3 pirates
      arcKill('ember', 0);     // (no pirate objective in Burn Bright)
    }
  }

  function finaleComplete(branch) {
    var s = ss();
    s.finaleDone = true;
    s.fall = 7;
    if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('finale_' + branch); } catch (e) {} }
    var p = SF.Player;
    if (branch === 'good') {
      playBarks(['finale_good_03', 'fall_23', 'fall_24']);
      p.credits += 2500;
      SF.Factions.shift('compact', 10);
      SF.Factions.shiftKarma(5);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u2714 THE FALL resolved in light. +2500cr, Compact +10.');
    } else if (branch === 'evil') {
      playBarks(['finale_evil_03', 'fall_23', 'fall_24']);
      p.credits += 2500;
      SF.Factions.shift('ember', 10);
      SF.Factions.shiftKarma(-5);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u2714 THE FALL resolved in fire. +2500cr, Ember +10.');
    } else {
      playBarks(['finale_neutral_04', 'fall_23', 'fall_24']);
      p.credits += 1500;
      SF.Factions.shiftKarma(5);
      SF.Factions.shift('compact', 5);
      SF.Factions.shift('drifters', 5);
      SF.Factions.shift('ember', 5);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u2714 THE FALL resolved in balance. +1500cr, all +5.');
    }
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
    if (SF.Save) SF.Save.save();
  }

  function karmaBranch() {
    var k = SF.Factions ? SF.Factions.karma() : 0;
    if (k >= 15) return 'good';
    if (k <= -15) return 'evil';
    return 'neutral';
  }

  function finaleStart(branch) {
    var s = ss();
    s.finale = branch;
    s.finaleKills = 0;
    s.fall = 6;
    if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('fall5'); } catch (e) {} }
    if (branch === 'good') {
      playBarks(['finale_good_01', 'fall_18']);
      var w = FALL_WAYPOINTS.finGood;
      setWaypoint(w.systemId, w.x, w.y, w.label);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('FINALE: defend the Solace relay from the Ember strike team.');
    } else if (branch === 'evil') {
      playBarks(['finale_evil_01', 'fall_19']);
      var we = FALL_WAYPOINTS.finEvil;
      setWaypoint(we.systemId, we.x, we.y, we.label);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('FINALE: destroy the Compact relay guard and seize the relay.');
    } else {
      playBark('fall_20');
      s.peace = { compact: false, drifters: false, ember: false };
      clearWaypoint();
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('FINALE: broker peace — win over all three factions\u2019 envoys.');
    }
    if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
  }

  /* ============================================================
   * FACTION ARCS
   * ============================================================ */

  var ARC_DEFS = {
    compact: {
      name: 'Solar Compact', npc: 'reyes', need: 25,
      title: 'Order\u2019s Shield',
      stages: [
        null,
        { brief: 'Destroy 3 pirates anywhere in the frontier.', need: 3 },
        { brief: 'Escort intercept: kill the raider pack shadowing the Compact freighter (waypoint).', wave: ['raider', 'raider', 'raider'], sys: 'solace' },
        { brief: 'Report to Marshal Reyes at Haven Dock.' }
      ],
      reward: { credits: 800, standing: 8, karma: 3 }
    },
    drifters: {
      name: 'Free Drifters', npc: 'kade', need: 25,
      title: 'Free Skies',
      stages: [
        null,
        { brief: 'Mine 12 ore for the Drifter refit fund.', mine: 12 },
        { brief: 'Clear the raider nest on the Drift lane (waypoint).', wave: ['raider', 'raider', 'drone', 'drone'], sys: 'drift' },
        { brief: 'Report to Captain Kade at Haven Dock.' }
      ],
      reward: { credits: 600, standing: 8, karma: 1 }
    },
    ember: {
      name: 'Ember Pact', npc: 'sorrow', need: 25,
      title: 'Burn Bright',
      stages: [
        null,
        { brief: 'Prove your fire: destroy a Compact patrol (waypoint).', wave: ['gunship', 'gunship'], sys: 'solace', patrol: 'compact' },
        { brief: 'Strip 8 ore from the Solace belt for the war foundry.', mine: 8 },
        { brief: 'Report to Herald Sorrow at Haven Dock.' }
      ],
      reward: { credits: 900, standing: 8, karma: -3 }
    }
  };

  function arcStage(factionId) { return ss().arcs[factionId] || 0; }

  function arcUnlocked(factionId) {
    return SF.Factions && SF.Factions.standing(factionId) >= ARC_DEFS[factionId].need;
  }

  function arcStart(factionId) {
    var s = ss();
    playBark(arcBark(factionId, 1));
    s.arcs[factionId] = 1;
    s.arcKills[factionId] = 0;
    var def = ARC_DEFS[factionId];
    var st = def.stages[1];
    if (st.wave) {
      // wave stages spawn on arrival in the target system (see checkArrival)
      var ap = ARC_WAYPOINTS[st.sys] || { x: 2100, y: 2100 };
      setWaypoint(st.sys, ap.x, ap.y,
        'arcwp:' + factionId + ':1|' + def.title + ' I — ' + sysName(st.sys) + ' system');
    } else {
      clearWaypoint();
    }
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast(def.title + ' I — ' + st.brief);
    if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
  }

  function arcKill(factionId, need) {
    var s = ss();
    var stage = s.arcs[factionId];
    if (!stage || stage !== 1) return;
    var st = ARC_DEFS[factionId].stages[1];
    if (st.need && !st.mine) {
      s.arcKills[factionId] = (s.arcKills[factionId] || 0) + 1;
      if (s.arcKills[factionId] >= st.need) { playBark('compact_arc_03'); arcAdvance(factionId); }
    }
  }

  // scripted-arc-wave kills: wave stage objectives count storyOid kills
  function arcWaveKill(factionId, tag) {
    var s = ss();
    var stage = s.arcs[factionId];
    var def = ARC_DEFS[factionId];
    if (!stage) return;
    var st = def.stages[stage];
    if (st && st.wave && storyKillsLeft(tag) === 0) arcAdvance(factionId);
  }

  var ARC_BARK_NEXT = {
    compact:  { 2: ['compact_arc_04'], 3: [] },
    drifters: { 2: ['drifter_arc_02'], 3: ['drifter_arc_04', 'drifter_arc_05'] },
    ember:    { 2: ['ember_arc_03'],   3: ['ember_arc_04', 'ember_arc_05'] }
  };
  function arcAdvance(factionId) {
    var s = ss();
    var def = ARC_DEFS[factionId];
    var next = s.arcs[factionId] + 1;
    if (next > 3) { arcComplete(factionId); return; }
    var nb = ARC_BARK_NEXT[factionId] && ARC_BARK_NEXT[factionId][next];
    if (nb && nb.length) playBarks(nb);
    s.arcs[factionId] = next;
    s.arcKills[factionId] = 0;
    var st = def.stages[next];
    if (st.wave) {
      // arc objective waypoints live in the target system; the wave
      // spawns when the player actually arrives there (see checkArrival)
      var ap = ARC_WAYPOINTS[st.sys] || { x: 2100, y: 2100 };
      setWaypoint(st.sys, ap.x, ap.y,
        'arcwp:' + factionId + ':' + next + '|' + def.title + ' ' + ['','I','II','III'][next] +
        ' — ' + sysName(st.sys) + ' system');
    } else {
      clearWaypoint();
    }
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast(def.title + ' ' + ['','I','II','III'][next] + ' — ' + st.brief);
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
  }

  function arcComplete(factionId) {
    var s = ss();
    var def = ARC_DEFS[factionId];
    playBark(arcBark(factionId, 6));
    s.arcs[factionId] = 4; // done
    if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('arc_' + factionId); } catch (e) {} }
    clearWaypoint();
    var p = SF.Player;
    p.credits += def.reward.credits;
    SF.Factions.shift(factionId, def.reward.standing);
    SF.Factions.shiftKarma(def.reward.karma);
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u2714 ' + def.title + ' complete! +' +
      def.reward.credits + 'cr, ' + def.name + ' +' + def.reward.standing);
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
    if (SF.Save) SF.Save.save();
  }

  /* ============================================================
   * STORY NPCS — dialogue UI via SF.Dialogue (npcs.js patterns)
   * ============================================================ */

  var STORY_NPCS = [
    { id: 'ash',    name: 'Ash — Wreck Survivor 🛰',  desc: 'Broadcast the name of a dead ship. Knows about the Fall.' },
    { id: 'reyes',  name: 'Marshal Reyes 🛡',     desc: 'Solar Compact envoy. Order has a price.' },
    { id: 'kade',   name: 'Captain Kade 🌿',      desc: 'Free Drifter broker. Freedom has a ledger.' },
    { id: 'sorrow', name: 'Herald Sorrow \U0001F525',  desc: 'Ember Pact voice. Fire remembers.' }
  ];
  var STORY_NPC_IDS = STORY_NPCS.map(function (n) { return n.id; });

  function dlg(spec) {
    if (SF.NPCs && SF.NPCs.dialogue) SF.NPCs.dialogue(spec);
    else if (SF.Dialogue) SF.Dialogue.open(spec);
  }

  function renderStoryNPCs(body) {
    STORY_NPCS.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'store-row';
      row.innerHTML =
        '<div class="store-info"><div><div class="store-name">' + n.name + '</div>' +
        '<div class="store-desc">' + n.desc + '</div></div></div>' +
        '<button class="btn store-btn">TALK</button>';
      row.querySelector('button').addEventListener('click', function () {
        SF.NPCs.talk(n.id);
      });
      body.appendChild(row);
    });
  }

  function talkNPC(id) {
    if (id === 'ash') ashDialogue();
    else if (id === 'reyes') factionDialogue('compact');
    else if (id === 'kade') factionDialogue('drifters');
    else if (id === 'sorrow') factionDialogue('ember');
  }

  /* ---- Ash: The Fall chain ---- */

  function ashDialogue() {
    var s = ss();
    if (s.fall === 0) {
      dlg({
        title: 'Ash — Wreck Survivor 🛰',
        text: '\u201CYou heard it too, didn\u2019t you? The signal. My ship — the Meridian — fell out of the black three weeks back, and it\u2019s been broadcasting a name on a dead channel ever since.\n\nYour name, captain.\n\nI\u2019ll mark the wreck\u2019s last signal on your scope. Go look. Whatever fell out there, it isn\u2019t done falling.\u201D',
        choices: [{
          label: '\u201CI\u2019ll find your wreck.\u201D (begin THE FALL)',
          run: function () { fallStart(); ashStageBrief(1); }
        }]
      });
    } else if (s.fall === 1) {
      ashStageBrief(1);
    } else if (s.fall === 2) {
      playBarks(['fall_05a', 'fall_05b', 'fall_06']);
      dlg({
        title: 'Ash — Wreck Survivor 🛰',
        text: '\u201CThe signal decoded to a courier manifest — a Drifter runner was paid to move Meridian salvage through the Drift, then silenced. Ember scouts, if the transponder ghosts are honest.\n\nThe courier\u2019s last known lane is marked. Someone out there knows what the Meridian carried — and they\u2019re willing to kill couriers to keep it quiet.\n\nA broker in the lane wants 200cr for the scout\u2019s patrol route. Or you could lean on him — he\u2019ll talk, but it won\u2019t be pretty.\u201D',
        choices: [
          { label: 'Pay 200cr for the patrol route', run: function () {
              if (SF.Player.credits >= 200) {
                SF.Player.credits -= 200;
                playBark('fall_07');
                var w = FALL_WAYPOINTS.drift;
                setWaypoint(w.systemId, w.x, w.y, w.label);
                dlg({ title: 'Ash', text: '\u201CRoute\u2019s yours. Fly the Drift lane — and watch your scope.\u201D', choices: [] });
                if (SF.HUD && SF.HUD.toast) SF.HUD.toast('New objective: ' + w.label);
              } else {
                dlg({ title: 'Ash', text: '\u201CShort on credits? Then lean on him — or come back richer.\u201D', choices: [] });
              }
            } },
          { label: 'Threaten the broker (karma −3)', run: function () {
              SF.Factions.shiftKarma(-3);
              playBark('fall_07');
              var w2 = FALL_WAYPOINTS.drift;
              setWaypoint(w2.systemId, w2.x, w2.y, w2.label);
              dlg({ title: 'Ash', text: '\u201CHe talked. Fast. You\u2019re learning the frontier\u2019s real currency.\u201D', choices: [] });
              if (SF.HUD && SF.HUD.toast) SF.HUD.toast('New objective: ' + w2.label);
            } }
        ]
      });
    } else if (s.fall === 3) {
      playBark('fall_10');
      dlg({
        title: 'Ash — Wreck Survivor 🛰',
        text: '\u201CThe scouts carried Ember cipher-keys — military grade. The Pact burned a whole colony in Ember to bury the Meridian\u2019s cargo. Whatever it is, it\u2019s worth a massacre to them.\n\nThere\u2019s a Pact quartermaster who\u2019ll deal. He\u2019ll sell you the colony\u2019s location for a favor — or the Compact will pay you to feed them the cipher-keys instead.\u201D',
        choices: [
          { label: 'Feed the keys to the Compact (+2 karma)', run: function () {
              SF.Factions.shiftKarma(2);
              SF.Factions.shift('compact', 4);
              playBark('fall_11');
              var w = FALL_WAYPOINTS.ember;
              setWaypoint(w.systemId, w.x, w.y, w.label);
              dlg({ title: 'Ash', text: '\u201CThe Compact thanks you. The colony site is marked — go see what they burned.\u201D', choices: [] });
              if (SF.HUD && SF.HUD.toast) SF.HUD.toast('New objective: ' + w.label);
            } },
          { label: 'Take the Pact\u2019s deal (−2 karma)', run: function () {
              SF.Factions.shiftKarma(-2);
              SF.Factions.shift('ember', 4);
              playBark('fall_11');
              var w2 = FALL_WAYPOINTS.ember;
              setWaypoint(w2.systemId, w2.x, w2.y, w2.label);
              dlg({ title: 'Ash', text: '\u201CThe quartermaster sends his regards. The colony site is marked.\u201D', choices: [] });
              if (SF.HUD && SF.HUD.toast) SF.HUD.toast('New objective: ' + w2.label);
            } }
        ]
      });
    } else if (s.fall === 4) {
      playBark('fall_14');
      dlg({
        title: 'Ash — Wreck Survivor 🛰',
        text: '\u201CThe colony wasn\u2019t burned for cargo, captain. It was burned for a relay — a pre-Collapse beacon the Meridian was hauling. Whoever holds it can hear every dead channel in the frontier.\n\nThe relay\u2019s core is cracked. I need 10 ore to machine a new housing before the signal dies for good.\u201D',
        choices: [
          { label: 'Hand over 10 ore', run: function () {
              if (SF.Player.ore >= 10) {
                SF.Player.ore -= 10;
                playBarks(['fall_15', 'fall_16']);
                s.fall = 5;
                if (window.SF && SF.Codex) { try { SF.Codex.unlockStory('fall4'); } catch (e) {} }
                dlg({ title: 'Ash', text: '\u201CIt\u2019s alive. Listen — it\u2019s already singing.\n\nThe relay will choose its keeper by the shape of their soul, captain. Your karma precedes you. Come back when you\u2019re ready to decide what the frontier becomes.\u201D', choices: [] });
                if (SF.HUD && SF.HUD.toast) SF.HUD.toast('The relay hums. Return to Ash when ready for the finale.');
              } else {
                dlg({ title: 'Ash', text: '\u201CNot enough ore. The belt\u2019s full of it — go crack some rocks.\u201D', choices: [] });
              }
            } }
        ]
      });
    } else if (s.fall === 5) {
      playBark('fall_17');
      var branch = karmaBranch();
      var kLabel = SF.Factions ? SF.Factions.karmaLabel() : 'Neutral';
      var desc = branch === 'good'
        ? '\u201CYour name opens doors, ' + kLabel + '. The Compact will stand with you. The Ember Pact is coming for the relay with a strike team — hold the line at the beacon, and the frontier hears the truth.\u201D'
        : branch === 'evil'
        ? '\u201CYour reputation walks in before you do, ' + kLabel + '. The Pact offers you the relay and everything it hears — all you have to do is cut down the Compact guard and take it.\u201D'
        : '\u201CYou belong to no one, ' + kLabel + ' — and that\u2019s your power. No army is coming. Win over the envoys of all three factions, one by one, and the relay becomes neutral ground. A free channel for a free frontier.\u201D';
      dlg({
        title: 'Ash — Wreck Survivor 🛰',
        text: desc + '\n\n\u201CThis is the choice the Fall was always about. There\u2019s no going back.\u201D',
        choices: [{
          label: branch === 'good' ? '\u201CWe hold the relay.\u201D (DEFEND — good finale)'
            : branch === 'evil' ? '\u201CThe relay is mine.\u201D (SEIZE — evil finale)'
            : '\u201CThe relay belongs to everyone.\u201D (BROKER PEACE — neutral finale)',
          run: function () { finaleStart(branch); ashFinaleBrief(branch); }
        }]
      });
    } else if (s.fall === 6) {
      ashFinaleBrief(s.finale);
    } else {
      var doneLine = s.finaleDone
        ? '\u201CThe frontier still hums with it. You did what the Fall asked, captain. Whatever comes next — it\u2019s yours.\u201D'
        : '\u201CThe relay waits. Finish what you started.\u201D';
      dlg({ title: 'Ash — Wreck Survivor 🛰', text: doneLine, choices: [] });
    }
  }

  function ashStageBrief(stage) {
    if (stage === 1) playBarks(['fall_01', 'fall_02']);
    var lines = {
      1: '\u201CThe wreck\u2019s last signal is marked on your scope. Solace system. Whatever\u2019s guarding it — fly careful, shoot straighter.\u201D'
    };
    dlg({
      title: 'Ash — Wreck Survivor 🛰',
      text: stage === 1 ? lines[1]
        : '\u201CThe Fall moves forward, captain. Check your scope — the next step is marked.\u201D',
      choices: []
    });
  }

  function ashFinaleBrief(branch) {
    var text = branch === 'good'
      ? '\u201CFly to the relay beacon in Solace. The Ember strike team is already burning in — hold them off until the relay locks. The frontier is watching.\u201D'
      : branch === 'evil'
      ? '\u201CFly to the relay beacon in Solace. The Compact guard won\u2019t hand it over — take it from them. The Pact rewards the bold.\u201D'
      : '\u201CNo armies. Just you and your word. Speak to Marshal Reyes, Captain Kade, and Herald Sorrow — win all three envoys over, and the relay becomes neutral ground.\u201D';
    dlg({ title: 'Ash — Wreck Survivor 🛰', text: text, choices: [] });
  }

  /* ---- faction NPC dialogues ---- */

  function factionDialogue(factionId) {
    var def = ARC_DEFS[factionId];
    var s = ss();
    var stage = s.arcs[factionId];

    // neutral-finale peace visits
    if (s.fall === 6 && s.finale === 'neutral' && !s.finaleDone) {
      if (!s.peace[factionId]) {
        s.peace[factionId] = true;
        var left = ['compact', 'drifters', 'ember'].filter(function (f) { return !s.peace[f]; });
        playBark({ compact: 'finale_neutral_01', drifters: 'finale_neutral_02',
          ember: 'finale_neutral_03' }[factionId]);
        var envoyLine = {
          compact: '\u201CMarshal Reyes studies you a long moment — then nods. \u2018The Compact will respect a neutral relay. You have my word.\u2019\u201D',
          drifters: '\u201CCaptain Kade grins. \u2018A free channel nobody owns? That\u2019s the Drifter dream, captain. We\u2019re in.\u2019\u201D',
          ember: '\u201CHerald Sorrow is silent a long time. \u2018The Pact does not share fire,\u2019 she says at last. \u2018But we will not burn this one. You have our word.\u2019\u201D'
        }[factionId];
        if (left.length === 0) {
          dlg({ title: def.name + ' envoy', text: envoyLine + '\n\n\u201CAll three envoys stand with you. The relay is neutral ground.\u201D', choices: [] });
          finaleComplete('neutral');
        } else {
          var names = left.map(function (f) { return ARC_DEFS[f].name; }).join(', ');
          dlg({ title: def.name + ' envoy', text: envoyLine + '\n\nStill to win over: ' + names + '.', choices: [] });
        }
      } else {
        dlg({ title: def.name + ' envoy', text: '\u201CWe\u2019ve already given our word, captain. The rest is up to you.\u201D', choices: [] });
      }
      return;
    }

    if (stage === 4) {
      dlg({ title: def.name, text: '\u201C' + def.title + ' is done, captain. The ' + def.name + ' won\u2019t forget it.\u201D', choices: [] });
      return;
    }
    if (stage >= 1 && stage <= 2) {
      var st = def.stages[stage];
      var prog = '';
      if (st.mine) prog = '\n\nOre delivered toward objective: this is tracked as you mine.';
      else if (st.need) prog = '\n\nPirates destroyed: ' + (s.arcKills[factionId] || 0) + '/' + st.need + '.';
      dlg({ title: def.name, text: '\u201C' + def.title + ' — ' + st.brief + prog + '\u201D', choices: [] });
      return;
    }
    if (stage === 3) {
      // turn-in
      dlg({
        title: def.name,
        text: '\u201CIt\u2019s done, then. The ' + def.name + ' pays its debts — in credits and in standing.\u201D',
        choices: [{ label: 'Collect reward', run: function () { arcComplete(factionId); } }]
      });
      return;
    }
    // stage 0: offer or locked
    if (!arcUnlocked(factionId)) {
      var have = SF.Factions ? SF.Factions.standing(factionId) : 0;
      dlg({
        title: def.name,
        text: '\u201CThe ' + def.name + ' doesn\u2019t hand out trust, captain. Raise your standing to +' +
          def.need + ' (now ' + (have >= 0 ? '+' : '') + have + ') and we\u2019ll talk work.\u201D',
        choices: []
      });
      return;
    }
    playBark(arcBark(factionId, 2));
    dlg({
      title: def.name,
      text: '\u201CYour standing precedes you, captain. The ' + def.name + ' has work for someone with your reputation.\n\n' +
        def.title + ' I — ' + def.stages[1].brief + '\n\nReward: ' + def.reward.credits + 'cr, +' +
        def.reward.standing + ' standing.\u201D',
      choices: [{ label: 'Accept: ' + def.title, run: function () { arcStart(factionId); } }]
    });
  }

  /* ---------------- per-frame ---------------- */

  function update(dt) {
    if (SF.Game.state !== 'PLAYING') return;
    var s = ss();
    // track ore mined (ore increases = mined)
    var ore = SF.Player.ore || 0;
    if (ore > s.lastOre) {
      var gained = ore - s.lastOre;
      s.mined += gained;
      // drifters arc I: mine 12 ore for the refit fund (stage 1)
      if (s.arcs.drifters === 1) {
        var st = ARC_DEFS.drifters.stages[1];
        if (st.mine && s.mined >= (s.arcMineStart || 0) + st.mine) arcAdvance('drifters');
      }
      // ember arc II: strip 8 ore (stage 2)
      if (s.arcs.ember === 2) {
        var ste = ARC_DEFS.ember.stages[2];
        if (ste.mine && s.mined >= (s.arcMineStart || 0) + ste.mine) arcAdvance('ember');
      }
    }
    s.lastOre = ore;
    checkArrival();
  }

  // snapshot the mined counter when a mine-stage begins
  var _arcAdvance = arcAdvance;
  arcAdvance = function (factionId) {
    var s = ss();
    var next = (s.arcs[factionId] || 0) + 1;
    var def = ARC_DEFS[factionId];
    var st = def.stages[next];
    if (st && st.mine) s.arcMineStart = s.mined;
    _arcAdvance(factionId);
  };
  // wrap arcStart the same way
  var _arcStart = arcStart;
  arcStart = function (factionId) {
    var def = ARC_DEFS[factionId];
    if (def.stages[1].mine) ss().arcMineStart = ss().mined;
    _arcStart(factionId);
  };

  function draw(ctx, time) {
    var s = ss();
    var wp = s.waypoint;
    if (!wp || SF.Game.systemId !== wp.systemId) return;
    var label = wp.label.indexOf('arcwp:') === 0 ? wp.label.split('|')[1] : wp.label;
    var pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.save();
    ctx.translate(wp.x, wp.y);
    ctx.rotate(Math.PI / 4 + time * 0.8);
    ctx.strokeStyle = 'rgba(255,210,63,' + (0.5 + 0.5 * pulse) + ')';
    ctx.lineWidth = 3;
    var r = 26 + pulse * 10;
    ctx.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#ffd23f';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, wp.x, wp.y - 40);
    ctx.restore();
  }

  /* ---------------- hooks into the existing game ---------------- */

  function installHooks() {
    // kill hook: extend (don't replace) quest kill counting
    if (SF.Quests && !SF.Quests._storyHooked) {
      SF.Quests._storyHooked = true;
      var qk = SF.Quests.onKill;
      SF.Quests.onKill = function (e) {
        qk.call(SF.Quests, e);
        try { onKill(e); } catch (err) { /* never break the kill path */ }
      };
    }
    // cantina: append story NPC rows after the built-in ones
    if (SF.NPCs && !SF.NPCs._storyHooked) {
      SF.NPCs._storyHooked = true;
      var rc = SF.NPCs.renderCantina;
      SF.NPCs.renderCantina = function (body) {
        rc.call(SF.NPCs, body);
        try { renderStoryNPCs(body); } catch (err) { /* never break the store */ }
      };
      var tk = SF.NPCs.talk;
      SF.NPCs.talk = function (id) {
        // codex-journal: meeting an NPC unlocks their character entry
        try { if (window.SF && SF.Codex) SF.Codex.metNPC(id); } catch (err) {}
        if (STORY_NPC_IDS.indexOf(id) >= 0) { talkNPC(id); return; }
        tk.call(SF.NPCs, id);
      };
    }
    // codex-journal: hiring a companion unlocks their character entry
    if (SF.Companions && !SF.Companions._codexHooked) {
      SF.Companions._codexHooked = true;
      var ch = SF.Companions.hire;
      SF.Companions.hire = function (id) {
        var r = ch.call(SF.Companions, id);
        if (r) { try { if (window.SF && SF.Codex) SF.Codex.unlockChar('companion', id); } catch (err) {} }
        return r;
      };
      if (SF.Companions.grant) {
        var cg = SF.Companions.grant;
        SF.Companions.grant = function (id) {
          var r2 = cg.call(SF.Companions, id);
          try { if (window.SF && SF.Codex) SF.Codex.unlockChar('companion', id); } catch (err) {}
          return r2;
        };
      }
    }
    // codex-journal: derelict / anomaly / dungeon / lifepod discoveries
    // unlock lore entries. investigate() opens multi-step dialogues, so
    // completion is picked up by a short reconcile watch (see SF.Codex).
    hookInvestigate(SF.Secrets);
    hookInvestigate(SF.Secrets2);
    // codex-journal: CODEX tab inside the quest log (SF.Quests.openLog wrap)
    if (SF.Quests && !SF.Quests._codexHooked) {
      SF.Quests._codexHooked = true;
      var qlog = SF.Quests.openLog;
      SF.Quests.openLog = function () {
        if (window.SF && SF.Codex && SF.Codex.tab() === 'codex') { SF.Codex.render(); }
        else {
          qlog.call(SF.Quests);
          try { if (window.SF && SF.Codex) SF.Codex.injectTabs(false); } catch (err) {}
        }
      };
    }
    // codex-journal: 'C' hotkey opens the codex while flying
    if (!window._sfCodexKeyHooked) {
      window._sfCodexKeyHooked = true;
      window.addEventListener('keydown', function (e) {
        if (e.code !== 'KeyC' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
        if (document.querySelector('.overlay:not(.hidden)')) return;
        try { SF.Codex.open(); } catch (err) {}
      });
    }
    // story wave kills: hook the storyOid branch via arcWaveKill in onKill
    if (SF.Quests && !SF.Quests._storyWaveHooked) {
      SF.Quests._storyWaveHooked = true;
      var qk2 = SF.Quests.onKill;
      SF.Quests.onKill = function (e) {
        qk2.call(SF.Quests, e);
        try {
          if (e && e.storyOid && e.storyOid.indexOf('arc-') === 0) {
            var parts = e.storyOid.split('-'); // arc-<faction>-<stage>
            arcWaveKill(parts[1], e.storyOid);
          }
        } catch (err) { /* never break the kill path */ }
      };
    }
  }

  // Wrap an investigate() so lore unlocks reconcile shortly after the
  // dialogue completes (never breaks the investigate path).
  function hookInvestigate(obj) {
    if (!obj || typeof obj.investigate !== 'function' || obj._codexWatchHooked) return;
    obj._codexWatchHooked = true;
    var iv = obj.investigate;
    obj.investigate = function (target, forced) {
      var r = iv.call(obj, target, forced);
      try { if (window.SF && SF.Codex) SF.Codex.watchLore(); } catch (err) {}
      return r;
    };
  }
  var Story = {
    playIntro: playIntro,
    finishIntro: finishIntro,
    wantsIntro: function () { return !ss().introSeen; },
    update: update,
    draw: draw,
    onKill: onKill,
    fallTitle: fallTitle,
    fallStage: function () { return ss().fall; },
    arcStage: arcStage,
    arcUnlocked: arcUnlocked,
    finaleBranch: karmaBranch,
    finaleDone: function () { return ss().finaleDone; },
    waypoint: function () { return ss().waypoint; },
    talkNPC: talkNPC,
    startFall: fallStart,
    startFinale: finaleStart,
    advanceFall: function (n) { ss().fall = n; },   // smoke-test helper
    advanceArc: function (f, n) { ss().arcs[f] = n; }, // smoke-test helper
    BEATS: BEATS
  };

  SF.Story = Story;

  // wire intro buttons once the DOM is ready (campaign.js loads before main.js init)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireIntro(); installHooks(); });
  } else {
    wireIntro(); installHooks();
  }
})();

/* ============================================================
 * STARFALL — codex-journal phase: In-game Codex
 *
 * SF.Codex: a CODEX tab rendered inside the quest-log overlay
 * (campaign.js-drawn DOM only — index.html / quests.js / hud.js are
 * outside this phase's file scope and were NOT touched).
 *
 * Content:
 *  - STORY: every campaign story beat (intro, The Fall I..V, the 3
 *    faction-arc payoffs, the 3 karma finales). Unlocked by the story
 *    engine via SF.Codex.unlockStory(id).
 *  - CHARACTERS: 6 hireable companions (unlocked on hire) + Ash /
 *    Reyes / Kade / Sorrow (unlocked on first talk) + station crew
 *    Zed / Okafor / Vane (unlocked on first talk).
 *  - LORE: derelicts, anomalies, the Hollow Cathedral dungeon,
 *    the lifepod (unlocked when discovered; reconciled from the
 *    secrets / secrets2 save blobs).
 *
 * Persistence: additive sub-blob on the existing campaign quest blob
 * (SF.Player.storyState.codex), defensive reads everywhere —
 * save-neutral, NO SF.SAVE_VERSION bump.
 *
 * Access: SF.Codex.open() / the CODEX tab in the quest log / 'C'
 * while PLAYING. Locked entries render as '???'.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---------------- persistence ---------------- */

  // storyState() mirrors the story-campaign blob access; codex() adds
  // the additive {s,c,l} maps with defensive defaults (old saves get
  // them lazily — save-neutral).
  function storyState() {
    if (!SF.Player) return null;
    var st = SF.Player.storyState;
    if (!st) {
      st = (SF.StoryDefault ? SF.StoryDefault() : { fall: 0 });
      SF.Player.storyState = st;
    }
    return st;
  }

  function blob() {
    var st = storyState();
    if (!st) return null;
    var c = st.codex;
    if (!c || typeof c !== 'object') { c = {}; st.codex = c; }
    if (!c.s || typeof c.s !== 'object') c.s = {};
    if (!c.c || typeof c.c !== 'object') c.c = {};
    if (!c.l || typeof c.l !== 'object') c.l = {};
    return c;
  }

  /* ---------------- catalogs ---------------- */

  var STORY_DEFS = [
    { id: 'intro', title: 'The Fall Begins',
      text: 'A wreck — the Meridian — tumbled out of the black broadcasting your name on a dead channel. ' +
            'Ash, its only survivor, marked the wreck\u2019s last signal on your scope. ' +
            'You chose to find out what fell.' },
    { id: 'fall1', title: 'The Fall I — Signal in the Static',
      text: 'You reached the Meridian\u2019s last signal and cut through the wreck-rats\u2019 ' +
            'ambush. The decoded signal pointed at a silenced Drifter courier in the Drift.' },
    { id: 'fall2', title: 'The Fall II — The Courier\u2019s Price',
      text: 'You avenged the courier on the Drift lane and took the Ember scouts\u2019 ' +
            'cipher keys — military grade. The Pact burned a whole colony to bury what the Meridian carried.' },
    { id: 'fall3', title: 'The Fall III — Ember\u2019s Bargain',
      text: 'You cleared the burned colony\u2019s perimeter. The colony wasn\u2019t burned for cargo — ' +
            'it was burned for a relay: a pre-Collapse beacon the Meridian was hauling.' },
    { id: 'fall4', title: 'The Fall IV — What Fell',
      text: 'You machined a new housing for the relay\u2019s cracked core. It woke, and started singing. ' +
            'The relay will choose its keeper by the shape of their soul.' },
    { id: 'fall5', title: 'The Fall V — The Relay',
      text: 'Karma precedes you, captain. You chose what the relay — and the frontier — would become. ' +
            'There was no going back.' },
    { id: 'arc_compact', title: 'Order\u2019s Shield — Complete',
      text: 'You flew for the Solar Compact: pirates broken, a freighter kept safe. ' +
            'Marshal Reyes paid in credits, standing, and respect.' },
    { id: 'arc_drifters', title: 'Free Skies — Complete',
      text: 'You flew for the Free Drifters: ore for the refit fund, a raider nest burned out. ' +
            'Captain Kade remembers its friends.' },
    { id: 'arc_ember', title: 'Burn Bright — Complete',
      text: 'You flew for the Ember Pact: a Compact patrol destroyed, the war foundry fed. ' +
            'Herald Sorrow honors fire with fire.' },
    { id: 'finale_good', title: 'The Fall Resolved: Light',
      text: 'You held the Solace relay against the Ember strike team with the Compact at your side. ' +
            'The frontier heard the truth. +2500cr.' },
    { id: 'finale_neutral', title: 'The Fall Resolved: Balance',
      text: 'You won over all three envoys, one by one. The relay is neutral ground — a free channel ' +
            'for a free frontier. +1500cr.' },
    { id: 'finale_evil', title: 'The Fall Resolved: Fire',
      text: 'You cut down the Compact guard and seized the relay by force. Everything it hears is yours. ' +
            'The Pact honors its own. +2500cr.' }
  ];

  // Fallback companion bios if SF.Companions.byId is unavailable.
  var COMP_FALLBACK = {
    rook:   { name: 'Rook',   portrait: '\u{1F9D1}\u200D\u{1F680}', tier: 'common',  cost: 250,  dps: 6,
              intro: 'Ex-freighter gunner. Steady hands, cheaper than a hull plate.' },
    vex:    { name: 'Vex',    portrait: '\u{1F469}\u200D\u2708\uFE0F', tier: 'veteran', cost: 500,  dps: 10,
              intro: 'Drifter scout with a fast trigger and faster mouth.' },
    bram:   { name: 'Bram',   portrait: '\u{1F9D9}', tier: 'veteran', cost: 650,  dps: 12,
              intro: 'Old Compact navy. Reads a scope like scripture.' },
    juno:   { name: 'Juno',   portrait: '\u{1F468}\u200D\u{1F680}', tier: 'elite',   cost: 1200, dps: 18,
              intro: 'Wing-leader out of the Ember war. Expensive. Worth it.' },
    nyx:    { name: 'Nyx',    portrait: '\u{1F9DB}', tier: 'ace',     cost: 2500, dps: 26,
              intro: 'Nobody knows who Nyx flew for before. Nobody asks twice.' },
    saskia: { name: 'Saskia', portrait: '\u{1F469}\u200D\u{1F680}', tier: 'legend',  cost: 4000, dps: 36,
              intro: 'The \u201CStorm of Ember Row\u201D. Legends charge legend rates.' }
  };
  var COMP_IDS = ['rook', 'vex', 'bram', 'juno', 'nyx', 'saskia'];

  var NPC_DEFS = {
    ash:    { name: 'Ash — Wreck Survivor \u{1F6F0}\uFE0F',
              text: 'Sole survivor of the Meridian. Broadcast the Fall\u2019s first signal on a dead channel. ' +
                    'Knows more about the relay than they say.' },
    reyes:  { name: 'Marshal Reyes \u{1F6E1}\uFE0F',
              text: 'Solar Compact envoy at Haven Dock. Order has a price — and a payroll. ' +
                    'Offers the Order\u2019s Shield arc to captains with +25 standing.' },
    kade:   { name: 'Captain Kade \u{1F33F}',
              text: 'Free Drifter broker at Haven Dock. Freedom has a ledger. ' +
                    'Offers the Free Skies arc to captains with +25 standing.' },
    sorrow: { name: 'Herald Sorrow \u{1F525}',
              text: 'Voice of the Ember Pact at Haven Dock. Fire remembers. ' +
                    'Offers the Burn Bright arc to captains with +25 standing.' },
    zed:    { name: 'Zed — Bartender \u{1F37A}',
              text: 'Knows every rumor on the station. A drink costs 10cr; the gossip is free to the thirsty. ' +
                    'Ask about work and he\u2019ll point you at the quest board.' },
    okafor: { name: 'Okafor — Shipwright',
              text: 'Repairs, refits, and tall tales. Can cut you a deal on hull work if you fly his way.' },
    vane:   { name: 'Recruiter Vane',
              text: 'Speaks for the factions. Pledges welcome — check your standing before you commit.' }
  };
  var NPC_IDS = ['ash', 'reyes', 'kade', 'sorrow', 'zed', 'okafor', 'vane'];

  // Lore defs are assembled from the live game data (derelicts, anomalies,
  // dungeons) so codex text always matches the installed content.
  function loreDefs() {
    var defs = [];
    (SF.DERELICTS || []).forEach(function (d) {
      var sys = (SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[d.systemId] && SF.SYSTEM_BY_ID[d.systemId].name) || d.systemId;
      defs.push({
        id: 'derelict_' + d.id,
        title: '\u2620 ' + d.name,
        text: 'Derelict investigated in ' + sys + '. Captain\u2019s log:\n\n\u201C' + (d.log || 'No log recovered.') + '\u201D'
      });
    });
    var s1 = (SF.Player && SF.Player.secrets) || {};
    if (s1.anomalyDone) { /* entry unlocked via syncLore */ }
    defs.push({
      id: 'anomaly_drift',
      title: '\u2726 The Drift Anomaly',
      text: 'A knot of bent starlight hanging in the Drift, humming at the edge of hearing. ' +
            'Those who touched it speak of a cache, or a raider ambush, or a strange calm settling over their karma.'
    });
    (SF.ANOMALIES || []).forEach(function (a) {
      defs.push({
        id: 'anomaly2_' + a.id,
        title: '\u2726 ' + (a.name || a.id),
        text: a.text || 'An unstable fold in space. Investigation advised — or not.'
      });
    });
    (SF.DUNGEONS || []).forEach(function (dg) {
      defs.push({
        id: 'dungeon_' + dg.id,
        title: '\u2620 ' + (dg.name || dg.id),
        text: 'A dead ship the size of a cathedral, drifting in the Drift. Three rooms deep: ' +
              'the Vestibule with its sealed crew locker, the Reactor Nave where the dark answers, ' +
              'and the Reliquary, glowing gold. Rotating-dial tumbler locks guard every cache.'
      });
    });
    defs.push({
      id: 'lifepod',
      title: '\u{1F6DF} Lifepod — Pale Lantern Signal',
      text: 'A ghost signal near the Pale Lantern resolved into a lifepod, still powered, viewport frosted over. ' +
            'Something moved behind the ice. Whoever was inside flies with you now — or doesn\u2019t, and the ' +
            'static fades.'
    });
    return defs;
  }

  function storyDef(id) {
    for (var i = 0; i < STORY_DEFS.length; i++) if (STORY_DEFS[i].id === id) return STORY_DEFS[i];
    return null;
  }
  function charDef(kind, id) {
    if (kind === 'npc') return NPC_DEFS[id] || null;
    var live = (SF.Companions && SF.Companions.byId && SF.Companions.byId[id]) || COMP_FALLBACK[id] || null;
    if (!live) return null;
    return {
      name: (live.portrait ? live.portrait + ' ' : '') + live.name + ' [' + (live.tier || 'crew') + ']',
      text: (live.intro || 'A pilot for hire.') + ' Hire: ' + (live.cost || 0) + 'cr. Wing DPS ~' + (live.dps || '?') + '.'
    };
  }
  function loreDef(id) {
    var defs = loreDefs();
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }
  function entry(cat, id) {
    if (cat === 's') return storyDef(id);
    if (cat === 'c') {
      var parts = ('' + id).split(':'); // "npc:zed" | "companion:rook"
      return charDef(parts[0], parts[1]);
    }
    return loreDef(id);
  }

  /* ---------------- unlock ---------------- */

  function unlock(cat, id) {
    var b;
    try { b = blob(); } catch (e) { b = null; }
    if (!b) return false;
    if (b[cat][id]) return false;
    b[cat][id] = Date.now();
    var e = null;
    try { e = entry(cat, id); } catch (err) { e = null; }
    try {
      if (e && SF.HUD && SF.HUD.toast) SF.HUD.toast('\u{1F4D6} Codex updated: ' + e.title);
    } catch (err) {}
    try { if (SF.Save) SF.Save.save(); } catch (err) {}
    return true;
  }

  function isUnlocked(cat, id) {
    try {
      var b = blob();
      return !!(b && b[cat] && b[cat][id]);
    } catch (e) { return false; }
  }

  // Public API accepts friendly category names too ('story'/'chars'/'lore').
  function normCat(cat) {
    if (cat === 'story' || cat === 'stories') return 's';
    if (cat === 'chars' || cat === 'char' || cat === 'characters' || cat === 'character') return 'c';
    if (cat === 'lore') return 'l';
    return cat;
  }

  /* ---------------- lore reconciliation ---------------- */

  // Reconcile lore unlocks from the secrets/secrets2 save blobs.
  // Called on codex open and by the post-investigate watch. Returns the
  // list of newly unlocked lore ids (toast fires inside unlock()).
  function syncLore() {
    var newly = [];
    try {
      var s1 = (SF.Player && SF.Player.secrets) || { investigated: {} };
      (SF.DERELICTS || []).forEach(function (d) {
        if (s1.investigated && s1.investigated[d.id] && unlock('l', 'derelict_' + d.id)) newly.push('derelict_' + d.id);
      });
      if (s1.anomalyDone && unlock('l', 'anomaly_drift')) newly.push('anomaly_drift');
      var s2 = (SF.Player && SF.Player.secretsState) || {};
      (SF.ANOMALIES || []).forEach(function (a) {
        if (s2.anomalies2Done && s2.anomalies2Done[a.id] && unlock('l', 'anomaly2_' + a.id)) newly.push('anomaly2_' + a.id);
      });
      (SF.DUNGEONS || []).forEach(function (dg) {
        if (s2.dungeon && s2.dungeon.room >= 1 && unlock('l', 'dungeon_' + dg.id)) newly.push('dungeon_' + dg.id);
      });
      if (s2.lifepodDone && unlock('l', 'lifepod')) newly.push('lifepod');
    } catch (e) { /* lore sync must never break the game */ }
    return newly;
  }

  var loreWatchTimer = null;
  // investigate() opens a multi-step dialogue; completion flags land in
  // the save blob only when the player takes the loot. Poll briefly after
  // each investigate so the lore entry unlocks (with toast) near the event.
  function watchLore() {
    if (loreWatchTimer) return;
    var n = 0;
    loreWatchTimer = setInterval(function () {
      n++;
      try { syncLore(); } catch (e) {}
      if (n >= 45) { clearInterval(loreWatchTimer); loreWatchTimer = null; }
    }, 2000);
  }

  /* ---------------- UI: CODEX tab in the quest log ---------------- */

  var _tab = 'quests'; // 'quests' | 'codex' (runtime only)
  var _openIdx = 0;    // disambiguates expand toggles

  function tab() { return _tab; }

  function questLogTitle() {
    var h = document.querySelector('#overlay-quests h2');
    if (h) h.textContent = (_tab === 'codex') ? '\u{1F4D6} CODEX' : '\u{1F4DC} QUEST LOG';
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (typeof text === 'string') d.textContent = text;
    return d;
  }

  function injectTabs(codexActive) {
    var body = document.getElementById('quests-body');
    if (!body) return;
    _tab = codexActive ? 'codex' : 'quests';
    var bar = el('div', null, null);
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    [['quests', '\u{1F4DC} QUESTS'], ['codex', '\u{1F4D6} CODEX']].forEach(function (pair) {
      var b = el('button', 'btn small', pair[1]);
      b.style.cssText = 'flex:1;' + (pair[0] === _tab ? 'border-color:#ffd23f;color:#ffd23f;' : '');
      b.addEventListener('click', function () {
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        _tab = pair[0];
        SF.Quests.openLog();
      });
      bar.appendChild(b);
    });
    body.insertBefore(bar, body.firstChild);
    questLogTitle();
  }

  function entryRow(cat, id, def) {
    var unlocked = isUnlocked(cat, id);
    var row = el('div', 'store-row', null);
    row.style.cssText = 'cursor:' + (unlocked ? 'pointer' : 'default') + ';' +
      (unlocked ? '' : 'opacity:0.55;');
    var info = el('div', 'store-info', null);
    var name = el('div', 'store-name', unlocked ? def.title : '???');
    if (!unlocked) name.style.letterSpacing = '4px';
    var desc = el('div', 'store-desc', unlocked ? '' : 'Undiscovered — keep flying, captain.');
    info.appendChild(name);
    info.appendChild(desc);
    row.appendChild(info);
    if (unlocked) {
      var full = el('div', 'store-desc', null);
      full.style.cssText = 'display:none;margin-top:6px;white-space:pre-wrap;color:#cfe3ff;';
      full.textContent = def.text;
      var idx = ++_openIdx;
      row.setAttribute('data-codex', cat + ':' + id + ':' + idx);
      row.addEventListener('click', function () {
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        full.style.display = (full.style.display === 'none') ? 'block' : 'none';
      });
      info.appendChild(full);
    }
    return row;
  }

  function section(body, title, rows) {
    var h = el('div', 'store-head', title);
    h.style.cssText = 'margin:12px 0 4px;color:#ffd23f;';
    body.appendChild(h);
    rows.forEach(function (r) { body.appendChild(r); });
  }

  function render() {
    try { syncLore(); } catch (e) {}
    var body = document.getElementById('quests-body');
    if (!body) return;
    _tab = 'codex';
    body.innerHTML = '';
    injectTabs(true);
    // STORY
    var srows = STORY_DEFS.map(function (d) { return entryRow('s', d.id, d); });
    section(body, 'THE FALL — STORY BEATS', srows);
    // CHARACTERS: companions then NPCs
    var crows = [];
    COMP_IDS.forEach(function (cid) {
      var def = charDef('companion', cid);
      if (def) crows.push(entryRow('c', 'companion:' + cid, def));
    });
    NPC_IDS.forEach(function (nid) {
      var ndef = charDef('npc', nid);
      if (ndef) crows.push(entryRow('c', 'npc:' + nid, ndef));
    });
    section(body, 'CHARACTERS', crows);
    // LORE
    var lrows = loreDefs().map(function (d) { return entryRow('l', d.id, d); });
    section(body, 'LORE — WRECKS & WONDERS', lrows);
    var counts = Codex.counts();
    var foot = el('div', 'store-desc',
      'Codex ' + counts.unlocked + '/' + counts.total + ' entries · new entries announce with \u{1F4D6}');
    foot.style.cssText = 'margin-top:12px;text-align:center;opacity:0.7;';
    body.appendChild(foot);
    questLogTitle();
    SF.Game.showOverlay('overlay-quests');
  }

  function open() { _tab = 'codex'; SF.Quests.openLog(); }
  function close() { if (SF.Quests) SF.Quests.closeLog(); }

  function counts() {
    var su = 0, cu = 0, lu = 0, i;
    for (i = 0; i < STORY_DEFS.length; i++) if (isUnlocked('s', STORY_DEFS[i].id)) su++;
    var cids = [];
    COMP_IDS.forEach(function (c) { cids.push('companion:' + c); });
    NPC_IDS.forEach(function (n) { cids.push('npc:' + n); });
    for (i = 0; i < cids.length; i++) if (isUnlocked('c', cids[i])) cu++;
    var lds = loreDefs();
    for (i = 0; i < lds.length; i++) if (isUnlocked('l', lds[i].id)) lu++;
    var total = STORY_DEFS.length + cids.length + lds.length;
    return {
      story: { unlocked: su, total: STORY_DEFS.length },
      chars: { unlocked: cu, total: cids.length },
      lore: { unlocked: lu, total: lds.length },
      unlocked: su + cu + lu, total: total
    };
  }

  var Codex = {
    open: open,
    close: close,
    render: render,
    injectTabs: injectTabs,
    tab: tab,
    unlockStory: function (id) { return unlock('s', id); },
    unlockChar: function (kind, id) { return unlock('c', kind + ':' + id); },
    unlockLore: function (id) { return unlock('l', id); },
    metNPC: function (id) {
      if (NPC_DEFS[id]) return unlock('c', 'npc:' + id);
      return false;
    },
    isUnlocked: function (cat, id) { return isUnlocked(normCat(cat), id); },
    syncLore: syncLore,
    watchLore: watchLore,
    counts: counts,
    entry: function (cat, id) { try { return entry(normCat(cat), id); } catch (e) { return null; } }
  };

  SF.Codex = Codex;
})();

/* ============================================================
 * STARFALL — new-game-plus phase: New Game+ prestige mode
 *
 * SF.NGPlus: a prestige loop for the campaign.
 *  - After the karma-gated finale completes (SF.Story.finaleDone()),
 *    the captain is offered NEW GAME+: the cycle counter increments.
 *  - Accept: campaign/story progress resets (fresh SF.StoryDefault();
 *    intro stays seen; the codex journal is preserved), faction
 *    standing resets to neutral-friendly (+10 each). KEPT: ship(s),
 *    parts, weapons, credits, ore, goods, skills, companions, quest
 *    log, bounties. Karma is left untouched (brief scope).
 *  - Enemies scale +50% damage and +50% hull per cycle
 *    (enemyMul = 1 + 0.5 * cycle) via wraps on SF.Enemies.spawn,
 *    SF.Enemies.spawnPatrol and SF.Bosses.spawnFor.
 *  - NG+ contract board: 6 elite-flagged hunt contracts. A cantina row
 *    (wrapping SF.NPCs.renderCantina) opens overlay-ngplus (campaign.js-
 *    drawn DOM; index.html untouched). Accepting sets a waypoint; on
 *    arrival the elite wave spawns tagged e.ngc; kills are counted via
 *    the SF.Quests.onKill chain; turn-in at the board pays out.
 *
 * Persistence: additive `ngplus` key on the player blob via serialize /
 * deserialize / create wraps (ship.js untouched) — save-neutral, NO
 * SF.SAVE_VERSION bump. Old saves normalize lazily (defensive reads).
 * Announce via SF.News.push (runtime call only; news.js untouched).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function wrap(obj, name, fn) {
    if (!obj || !obj[name] || obj[name].__ngplus) return false;
    var orig = obj[name];
    var w = function () { return fn.call(this, orig, arguments); };
    w.__ngplus = true;
    obj[name] = w;
    return true;
  }

  /* ---------------- persistence (additive, save-neutral) ---------------- */

  function defaultNG() {
    return {
      cycle: 0,        // NG+ cycle count; 0 = not yet prestiged
      offered: false,  // offer shown for the current cycle's finale
      contracts: { active: null, progress: 0, done: [], waypoint: null }
    };
  }

  function normalize(d) {
    var n = defaultNG();
    if (d && typeof d === 'object') {
      if (typeof d.cycle === 'number' && isFinite(d.cycle)) {
        n.cycle = clamp(Math.floor(d.cycle), 0, 99);
      }
      n.offered = !!d.offered;
      var c = d.contracts;
      if (c && typeof c === 'object') {
        n.contracts.active = (typeof c.active === 'string') ? c.active : null;
        if (typeof c.progress === 'number' && isFinite(c.progress)) {
          n.contracts.progress = Math.max(0, Math.floor(c.progress));
        }
        n.contracts.done = Array.isArray(c.done)
          ? c.done.filter(function (x) { return typeof x === 'string'; })
          : [];
        var wp = c.waypoint;
        n.contracts.waypoint = (wp && typeof wp === 'object' &&
          typeof wp.systemId === 'string') ? wp : null;
      }
    }
    return n;
  }

  // Plain own-property on the SF.Player facade (skills.js skillState
  // pattern) — survives create()/deserialize() which only touch P.*.
  function blob() {
    if (!SF.Player) return defaultNG();
    var n = SF.Player.ngplus;
    if (!n || typeof n !== 'object' || typeof n.cycle !== 'number') {
      n = normalize(n);
      SF.Player.ngplus = n;
    }
    if (!n.contracts || typeof n.contracts !== 'object') {
      n.contracts = { active: null, progress: 0, done: [], waypoint: null };
    }
    return n;
  }

  function isActive() { return blob().cycle > 0; }
  function enemyMul() { return 1 + 0.5 * blob().cycle; }

  /* ---------------- enemy scaling ---------------- */

  function scaleEnemy(e) {
    var m = enemyMul();
    if (!e || !(m > 1)) return e;
    if (typeof e.hp === 'number') {
      e.hp = e.hp * m;
      e.maxHp = e.maxHp * m;
    }
    e.dmgMul = (e.dmgMul || 1) * m;
    e.ngplusScaled = true;
    return e;
  }

  /* ---------------- the offer ---------------- */

  function closeDlg() {
    if (window.SF && SF.Game) SF.Game.hideOverlay('overlay-dialogue');
  }

  function dlg(spec) {
    if (SF.NPCs && SF.NPCs.dialogue) SF.NPCs.dialogue(spec);
    else if (SF.Dialogue) SF.Dialogue.open(spec);
  }

  function offerText() {
    var b = blob();
    var branch = '';
    try { branch = (SF.Player.storyState && SF.Player.storyState.finale) || ''; } catch (e) {}
    var branchLine = branch
      ? 'The Fall is resolved — in ' + branch + '.'
      : 'The Fall is resolved.';
    return '🌀 NEW GAME+ ' + (b.cycle + 1) + '\n\n' + branchLine +
      '\n\nThe relay hums with your name on it, captain — and the frontier ' +
      'is already forgetting. Begin the cycle anew: The Fall resets, ' +
      'faction standing returns to neutral-friendly (+10 each).' +
      '\n\nYOU KEEP: your ship, parts, weapons, credits, ore, skills, ' +
      'companions, quest log.' +
      '\n\nTHE PRICE: every enemy in the frontier fights +50% harder — ' +
      '+50% hull, +50% damage. And the NG+ contract board opens: 6 elite ' +
      'hunts with elite payouts.' +
      '\n\nTake the cycle?';
  }

  function showOffer() {
    var b = blob();
    var n = b.cycle + 1;
    dlg({
      title: '🌀 NEW GAME+ ' + n,
      text: offerText(),
      choices: [
        {
          label: '▶ BEGIN NEW GAME+ ' + n + ' — reset the board',
          run: function () { closeDlg(); acceptNGPlus(); }
        },
        {
          label: 'Not yet — the offer stands with Ash',
          run: function () {
            closeDlg();
            if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Ash will hold the offer at Haven Dock.');
            if (SF.Save) SF.Save.save();
          }
        }
      ]
    });
    /* voice-wiring-v6b: speak the offer line (cycle 0: offer_01/02 rotate,
     * cycle >= 1: the NG+2 re-offer line). Guarded, fire-and-forget. */
    if (window.SF && SF.NGPlusVoice6) SF.NGPlusVoice6.offer(b.cycle);
  }

  // Fires once per cycle, on the first PLAYING frame after the finale
  // completes (SF.Story.update runs per frame; we wrap it below).
  function maybeOffer() {
    if (!SF.Game || SF.Game.state !== 'PLAYING') return;
    if (!SF.Story || !SF.Story.finaleDone()) return;
    var b = blob();
    if (b.offered) return;
    // a dialogue is already open — retry next frame, don't stack
    if (document.querySelector('#overlay-dialogue:not(.hidden)')) return;
    b.offered = true;
    if (SF.Save) { try { SF.Save.save(); } catch (e) {} }
    showOffer();
  }

  function acceptNGPlus() {
    /* voice-wiring-v6b: speak the accept line before the reset. Guarded. */
    if (window.SF && SF.NGPlusVoice6) SF.NGPlusVoice6.accept();
    var b = blob();
    var p = SF.Player;
    b.cycle += 1;
    b.offered = false; // re-arm: the next cycle's finale re-offers
    b.contracts = { active: null, progress: 0, done: [], waypoint: null };

    // reset campaign/story progress; preserve the codex journal and keep
    // the intro seen (veterans don't rewatch the cinematic)
    var codex = null;
    try { codex = p.storyState && p.storyState.codex; } catch (e) {}
    var fresh = SF.StoryDefault ? SF.StoryDefault() : {
      introSeen: false, fall: 0, fallKills: 0,
      arcs: { compact: 0, drifters: 0, ember: 0 }, arcKills: {},
      peace: { compact: false, drifters: false, ember: false },
      finale: null, finaleDone: false, finaleKills: 0,
      waypoint: null, lastOre: 0, mined: 0
    };
    fresh.introSeen = true;
    if (codex && typeof codex === 'object') fresh.codex = codex;
    p.storyState = fresh;

    // faction standing -> neutral-friendly (+10 each)
    try {
      var fs = p.factionState;
      if (fs) { fs.compact = 10; fs.drifters = 10; fs.ember = 10; }
    } catch (e) {}

    if (window.SF && SF.News) {
      try {
        SF.News.push('🌀 NEW GAME+ ' + b.cycle +
          ': the captain resets the board. The Fall begins anew — enemies +50% damage & hull.');
      } catch (e) {}
    }
    if (SF.HUD && SF.HUD.toast) {
      SF.HUD.toast('🌀 NEW GAME+ ' + b.cycle + ' — enemies +50%. The Fall awaits, again.');
    }
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
    // crew-depth-wiring: roster survives prestige — boost morale, mark cycle
    // veterans (levels persist by construction; acceptNGPlus keeps the crew)
    if (window.SF && SF.Crew && SF.Crew.onPrestige && p.ships)
      p.ships.forEach(function (sh) { SF.Crew.onPrestige(sh); });
    if (SF.Save) SF.Save.save();
    return b.cycle;
  }

  /* ---------------- NG+ contract board ---------------- */

  var CONTRACTS = [
    { id: 'ng-swift-hunt', title: 'Hunt the Swift', elite: 'fast', base: 'raider',
      n: 3, reward: 1500, sys: 'drift', x: 3300, y: 900,
      brief: 'Fast elites are cutting the Drift lanes. Burn 3 of them down.' },
    { id: 'ng-wall-break', title: 'Break the Wall', elite: 'bulwark', base: 'gunship',
      n: 2, reward: 1800, sys: 'ember', x: 2100, y: 3100,
      brief: 'Bulwark elites hold the Ember foundry approach. Crack 2 hulls.' },
    { id: 'ng-brood-silence', title: 'Silence the Brood', elite: 'swarmlord', base: 'gunship',
      n: 1, reward: 2200, sys: 'drift', x: 3300, y: 900,
      brief: 'A Swarmlord broodmother nests in the Drift. End it.' },
    { id: 'ng-pack-hunt', title: 'The Red Pack', elite: 'fast', base: 'raider',
      n: 5, reward: 2600, sys: 'ember', x: 2100, y: 3100,
      brief: 'A pack of 5 Fast elites runs the Ember gauntlet. Thin them out.' },
    { id: 'ng-siege-line', title: 'Siege Line', elite: 'bulwark', base: 'gunship',
      n: 3, reward: 2400, sys: 'solace', x: 3000, y: 1200,
      brief: 'Bulwark elites probe the Solace relay. Hold the line: 3 kills.' },
    { id: 'ng-apex-predator', title: 'Apex Predators', elite: 'swarmlord', base: 'gunship',
      n: 2, reward: 3500, sys: 'ember', x: 2100, y: 3100,
      brief: 'Two Swarmlords coordinate the deep Ember raids. Kill both.' }
  ];

  function contractById(id) {
    for (var i = 0; i < CONTRACTS.length; i++) {
      if (CONTRACTS[i].id === id) return CONTRACTS[i];
    }
    return null;
  }

  function acceptContract(id) {
    if (!isActive()) return false;
    var b = blob(), c = b.contracts;
    if (c.active || c.done.indexOf(id) >= 0) return false;
    var def = contractById(id);
    if (!def) return false;
    c.active = id;
    c.progress = 0;
    c.waypoint = { systemId: def.sys, x: def.x, y: def.y,
      label: 'NG+ contract: ' + def.title };
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('📋 Contract accepted: ' + def.title);
    if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    if (SF.Save) SF.Save.save();
    return true;
  }

  function abandonContract() {
    var c = blob().contracts;
    if (!c.active) return false;
    c.active = null;
    c.progress = 0;
    c.waypoint = null;
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('NG+ contract abandoned.');
    if (SF.Save) SF.Save.save();
    return true;
  }

  function turnIn() {
    var c = blob().contracts;
    var def = c.active && contractById(c.active);
    if (!def || c.progress < def.n) return false;
    SF.Player.credits += def.reward;
    c.done.push(def.id);
    c.active = null;
    c.progress = 0;
    c.waypoint = null;
    if (window.SF && SF.News) {
      try {
        SF.News.push('🏆 NG+ contract paid: ' + def.title + ' — +' + def.reward + 'cr.');
      } catch (e) {}
    }
    if (SF.HUD && SF.HUD.toast) SF.HUD.toast('✔ Contract paid: +' + def.reward + 'cr');
    if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
    if (SF.Save) SF.Save.save();
    return true;
  }

  function sysMul(systemId) {
    var s = SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[systemId];
    return s ? s.enemyMul : 1;
  }

  function spawnContractWave(def) {
    var p = SF.Player;
    var mul = sysMul(def.sys);
    for (var i = 0; i < def.n; i++) {
      var a = Math.random() * Math.PI * 2;
      var d = 560 + i * 90;
      // SF.Enemies.spawn is wrapped above: NG+ scaling applies here too
      var e = SF.Enemies.spawn(def.base,
        p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, mul, { elite: def.elite });
      if (e) e.ngc = def.id;
    }
  }

  // arrival at the active contract waypoint spawns the elite wave
  function checkContractArrival() {
    if (!SF.Game || SF.Game.state !== 'PLAYING') return;
    var c = blob().contracts;
    var wp = c.waypoint;
    if (!wp || !c.active) return;
    if (SF.Game.systemId !== wp.systemId) return;
    var p = SF.Player;
    var dx = p.x - wp.x, dy = p.y - wp.y;
    if (dx * dx + dy * dy > 300 * 300) return;
    var def = contractById(c.active);
    if (def) {
      spawnContractWave(def);
      if (SF.HUD && SF.HUD.toast) {
        SF.HUD.toast('⚠ NG+ contract hostiles on scope — ' + def.title);
      }
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
    }
    c.waypoint = null;
    if (SF.Save) SF.Save.save();
  }

  function drawContractWaypoint(ctx, time) {
    if (!SF.Game) return;
    var c = blob().contracts;
    var wp = c.waypoint;
    if (!wp || !c.active || SF.Game.systemId !== wp.systemId) return;
    var def = contractById(c.active);
    var label = def ? def.title : wp.label;
    var pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.save();
    ctx.translate(wp.x, wp.y);
    ctx.rotate(Math.PI / 4 + time * 0.8);
    ctx.strokeStyle = 'rgba(180,92,255,' + (0.5 + 0.5 * pulse) + ')';
    ctx.lineWidth = 3;
    var r = 26 + pulse * 10;
    ctx.strokeRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#b45cff';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, wp.x, wp.y - 40);
    ctx.restore();
  }

  /* ---------------- board UI (campaign.js-drawn DOM) ---------------- */

  function ensureOverlay() {
    var o = $('overlay-ngplus');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'overlay-ngplus';
    o.className = 'overlay hidden';
    var panel = document.createElement('div');
    panel.className = 'panel wide';
    var h = document.createElement('h2');
    h.textContent = '⭐ NEW GAME+ CONTRACTS';
    var sub = document.createElement('div');
    sub.className = 'store-desc';
    sub.id = 'ngp-sub';
    var list = document.createElement('div');
    list.id = 'ngp-list';
    var close = document.createElement('button');
    close.id = 'ngp-close';
    close.className = 'btn big ui-block';
    close.textContent = 'CLOSE';
    close.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      closeBoard();
    });
    panel.appendChild(h);
    panel.appendChild(sub);
    panel.appendChild(list);
    panel.appendChild(close);
    o.appendChild(panel);
    document.body.appendChild(o);
    return o;
  }

  function eliteName(variant) {
    var vd = SF.ELITE_VARIANTS && SF.ELITE_VARIANTS[variant];
    return vd ? vd.name : variant;
  }

  function openBoard() {
    var b = blob();
    if (!isActive()) return false;
    ensureOverlay();
    var sub = $('ngp-sub');
    if (sub) {
      sub.textContent = 'Cycle ' + b.cycle + ' — enemies +' +
        Math.round((enemyMul() - 1) * 100) + '% damage & hull. Elite contracts only.';
    }
    var list = $('ngp-list');
    list.innerHTML = '';
    var c = b.contracts;
    CONTRACTS.forEach(function (def) {
      var done = c.done.indexOf(def.id) >= 0;
      var active = c.active === def.id;
      var row = document.createElement('div');
      row.className = 'store-row';
      var info = document.createElement('div');
      info.className = 'store-info';
      var nm = document.createElement('div');
      nm.className = 'store-name';
      nm.textContent = (done ? '✔ ' : '🎯 ') + def.title + ' — ' + eliteName(def.elite) +
        ' ×' + def.n;
      var ds = document.createElement('div');
      ds.className = 'store-desc';
      ds.textContent = def.brief + ' Reward: ' + def.reward + 'cr' +
        (active ? ' — progress ' + Math.min(c.progress, def.n) + '/' + def.n : '');
      info.appendChild(nm);
      info.appendChild(ds);
      row.appendChild(info);
      var btn = document.createElement('button');
      btn.className = 'btn store-btn';
      if (done) {
        btn.textContent = 'DONE';
        btn.disabled = true;
      } else if (active) {
        if (c.progress >= def.n) {
          btn.textContent = 'TURN IN';
          btn.id = 'ngp-turnin';
          btn.addEventListener('click', function () {
            if (turnIn()) openBoard();
          });
        } else {
          btn.textContent = 'ABANDON';
          btn.id = 'ngp-abandon';
          btn.addEventListener('click', function () {
            if (abandonContract()) openBoard();
          });
        }
      } else if (c.active) {
        btn.textContent = 'BUSY';
        btn.disabled = true;
      } else {
        btn.textContent = 'ACCEPT';
        btn.id = 'ngp-accept-' + def.id;
        (function (cid) {
          btn.addEventListener('click', function () {
            if (acceptContract(cid)) openBoard();
          });
        })(def.id);
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
    SF.Game.showOverlay('overlay-ngplus');
    return true;
  }

  function closeBoard() {
    var o = $('overlay-ngplus');
    if (o) o.classList.add('hidden');
  }

  function renderBoardRow(body) {
    if (!isActive()) return;
    var row = document.createElement('div');
    row.className = 'store-row';
    var info = document.createElement('div');
    info.className = 'store-info';
    var nm = document.createElement('div');
    nm.className = 'store-name';
    nm.textContent = '⭐ NG+ CONTRACT BOARD';
    var ds = document.createElement('div');
    ds.className = 'store-desc';
    ds.textContent = 'Elite hunts for cycle-' + blob().cycle +
      ' captains. Big game, big payouts.';
    info.appendChild(nm);
    info.appendChild(ds);
    row.appendChild(info);
    var btn = document.createElement('button');
    btn.className = 'btn store-btn';
    btn.id = 'ngp-open';
    btn.textContent = 'OPEN';
    btn.addEventListener('click', function () {
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      openBoard();
    });
    row.appendChild(btn);
    body.appendChild(row);
  }

  /* ---------------- hooks ---------------- */

  function installHooks() {
    // persistence: additive ngplus key on the player blob (save-neutral)
    if (SF.Player) {
      wrap(SF.Player, 'serialize', function (orig, args) {
        var d = orig.apply(this, args);
        d.ngplus = JSON.parse(JSON.stringify(normalize(SF.Player.ngplus)));
        return d;
      });
      wrap(SF.Player, 'deserialize', function (orig, args) {
        orig.apply(this, args);
        SF.Player.ngplus = normalize(args[0] && args[0].ngplus);
      });
      wrap(SF.Player, 'create', function (orig, args) {
        orig.apply(this, args);
        SF.Player.ngplus = defaultNG();
      });
    }

    // enemy scaling: +50% hull & damage per NG+ cycle
    if (SF.Enemies) {
      wrap(SF.Enemies, 'spawn', function (orig, args) {
        return scaleEnemy(orig.apply(this, args));
      });
      wrap(SF.Enemies, 'spawnPatrol', function (orig, args) {
        var before = SF.Enemies.list.length;
        var r = orig.apply(this, args);
        if (enemyMul() > 1) {
          for (var i = before; i < SF.Enemies.list.length; i++) {
            scaleEnemy(SF.Enemies.list[i]);
          }
        }
        return r;
      });
    }
    if (window.SF && SF.Bosses) {
      wrap(SF.Bosses, 'spawnFor', function (orig, args) {
        return scaleEnemy(orig.apply(this, args));
      });
    }

    // per-frame: NG+ offer + contract waypoint arrival
    if (SF.Story) {
      wrap(SF.Story, 'update', function (orig, args) {
        orig.apply(this, args);
        try { maybeOffer(); } catch (e) {}
        try { checkContractArrival(); } catch (e) {}
      });
      wrap(SF.Story, 'draw', function (orig, args) {
        orig.apply(this, args);
        try { drawContractWaypoint(args[0], args[1]); } catch (e) {}
      });
      // Ash re-offers NG+ after a decline (or a declined later cycle)
      wrap(SF.Story, 'talkNPC', function (orig, args) {
        if (args[0] === 'ash' && SF.Story.finaleDone && SF.Story.finaleDone()) {
          if (blob().offered) { showOffer(); return; }
        }
        return orig.apply(this, args);
      });
    }

    // contract kill counting rides the SF.Quests.onKill chain
    if (SF.Quests) {
      wrap(SF.Quests, 'onKill', function (orig, args) {
        orig.apply(this, args);
        try {
          var e = args[0];
          var c = blob().contracts;
          if (e && e.ngc && c.active === e.ngc) {
            var def = contractById(c.active);
            c.progress++;
            if (SF.HUD && SF.HUD.toast) {
              if (def) {
                SF.HUD.toast('🎯 ' + def.title + ': ' +
                  Math.min(c.progress, def.n) + '/' + def.n);
                if (c.progress >= def.n) {
                  SF.HUD.toast('✔ Contract complete — turn it in at the NG+ board.');
                }
              }
            }
            if (SF.Save) SF.Save.save();
          }
        } catch (err) {}
      });
    }

    // cantina: NG+ contract board row (chains after the story-NPC rows)
    if (SF.NPCs) {
      wrap(SF.NPCs, 'renderCantina', function (orig, args) {
        orig.apply(this, args);
        try { renderBoardRow(args[0]); } catch (e) {}
      });
    }
  }

  var NGPlus = {
    blob: blob,
    isActive: isActive,
    cycle: function () { return blob().cycle; },
    enemyMul: enemyMul,
    offer: showOffer,        // test hook + Ash re-offer path
    accept: acceptNGPlus,
    offered: function () { return blob().offered; },
    contracts: function () { return CONTRACTS.slice(); },
    contractState: function () { return blob().contracts; },
    acceptContract: acceptContract,
    abandonContract: abandonContract,
    turnIn: turnIn,
    openBoard: openBoard,
    closeBoard: closeBoard
  };

  SF.NGPlus = NGPlus;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHooks);
  } else {
    installHooks();
  }
})();

/* ============================================================
 * STARFALL — ngplus-voice-wiring phase (2026-10-20)
 *
 * Wires voice-pack-5's codex/broker lines into the campaign and
 * quests. js/campaign.js ONLY — quests.js is NOT touched; the
 * daily-contract and elite-bounty systems are reached purely
 * through their existing runtime hooks (SF.Quests.renderBoard,
 * SF.Daily.accept / SF.Daily.expireTick, SF.EliteContracts.list).
 *
 * Voice ids are taken verbatim from
 * phases/voice-pack-5/VOICE-MANIFEST-5.md (codex_01..08,
 * broker_01..04) — no invented ids.
 *
 * Triggers:
 *  - codex_01: the codex journal opens (SF.Codex.render wrap — covers
 *    the CODEX tab, SF.Codex.open() and the 'C' hotkey).
 *  - codex_02..06: Fall chapters I..V unlock (SF.Codex.unlockStory
 *    wrap: fall1->codex_02, fall2->codex_03, fall3->codex_04,
 *    fall4->codex_05, fall5->codex_06).
 *  - codex_07: any other NEW codex entry unlocks
 *    (unlockStory / unlockChar / unlockLore / metNPC wraps —
 *    only when the unlock call reports a genuinely new entry).
 *  - codex_08: archive milestone — the first unlock that pushes the
 *    codex past 50% of all entries (runtime flag, save-neutral).
 *  - broker_01: quest board opens / refreshes (SF.Quests.renderBoard
 *    wrap; fires on a fresh open, not on re-renders within 2s).
 *  - broker_02: daily contract accepted (SF.Daily.accept wrap, only
 *    on a successful accept).
 *  - broker_03: daily contract expired (SF.Daily.expireTick wrap, only
 *    when a stale contract was actually dropped).
 *  - broker_04: an elite-bounty contract posts (3s watcher on
 *    SF.EliteContracts.list(); fires when a contract id appears that
 *    was not in the baseline snapshot — i.e. a rotation post).
 *
 * Playback: if (SF.Audio && SF.Audio.voice) SF.Audio.voice(id)
 * (guarded, never throws) + the campaign.js subtitle caption pattern
 * (#sf-voice-caption, created lazily if absent — reuses the element
 * the voice-barks wiring created when it is already there).
 *
 * Save-neutral: no persisted state, no SF.SAVE_VERSION bump. The
 * archive-milestone flag is runtime-only.
 *
 * Public surface: SF.NGPlusVoice { play, ids, _resetEliteBaseline,
 * _eliteTick, _counts } — test hooks for the smoke test.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.__ngplusVoiceWiring) return; // no double install
  SF.__ngplusVoiceWiring = true;

  /* line table — ids + caption text per VOICE-MANIFEST-5.md */
  var LINES = {
    'codex_01': { n: 'CODEX',  c: '#b48cff', t: "Starfall codex. Entry one: the night the sky caught fire.", d: 4.06 },
    'codex_02': { n: 'CODEX',  c: '#b48cff', t: "The Fall. Part one. Meridian burned first.", d: 3.44 },
    'codex_03': { n: 'CODEX',  c: '#b48cff', t: "The Fall. Part two. The Compact scattered.", d: 3.48 },
    'codex_04': { n: 'CODEX',  c: '#b48cff', t: "The Fall. Part three. The Drifters went dark.", d: 3.55 },
    'codex_05': { n: 'CODEX',  c: '#b48cff', t: "The Fall. Part four. Ember made its bargain.", d: 3.24 },
    'codex_06': { n: 'CODEX',  c: '#b48cff', t: "The Fall. Part five. And you woke up in the wreckage.", d: 3.91 },
    'codex_07': { n: 'CODEX',  c: '#b48cff', t: "New codex entry unlocked. The story writes itself.", d: 3.70 },
    'codex_08': { n: 'CODEX',  c: '#b48cff', t: "The archive grows. History remembers the bold.", d: 3.29 },
    'broker_01': { n: 'BROKER', c: '#ffd23f', t: "Fresh contracts on the board. Take your pick.", d: 3.01 },
    'broker_02': { n: 'BROKER', c: '#ffd23f', t: "Contract accepted. Clock's ticking.", d: 2.68 },
    'broker_03': { n: 'BROKER', c: '#ffd23f', t: "Contract expired. The target slipped away.", d: 3.15 },
    'broker_04': { n: 'BROKER', c: '#ffd23f', t: "Elite bounty posted. Big risk.", d: 2.49 }
  };

  /* ---------------- caption + playback ---------------- */

  var captionTimer = null;

  // Reuses the #sf-voice-caption element the voice-barks wiring
  // creates; builds one with the same styling if it is absent.
  function showCaption(v) {
    try {
      var el = document.getElementById('sf-voice-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sf-voice-caption';
        el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);' +
          'max-width:min(86vw,640px);padding:10px 14px;border-radius:10px;' +
          'background:rgba(4,8,18,.82);border:1px solid rgba(127,212,255,.35);' +
          'color:#eaf4ff;font:15px/1.45 system-ui,sans-serif;text-align:center;' +
          'z-index:9999;pointer-events:none;display:none;text-shadow:0 1px 2px #000;';
        document.body.appendChild(el);
      }
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:' + v.c +
        ';margin-bottom:4px;font-weight:700;';
      sp.textContent = v.n;
      var tx = document.createElement('div');
      tx.textContent = v.t;
      el.appendChild(sp); el.appendChild(tx);
      el.style.display = 'block';
      if (captionTimer) clearTimeout(captionTimer);
      captionTimer = setTimeout(function () {
        captionTimer = null;
        try { el.style.display = 'none'; } catch (e) {}
      }, Math.max(1200, v.d * 1000));
    } catch (e) { /* captions must never break the game */ }
  }

  function playLine(id) {
    var v = LINES[id];
    if (!v) return;
    try {
      if (SF.Audio && SF.Audio.voice) SF.Audio.voice(id);
    } catch (err) { /* voice must never break the game */ }
    showCaption(v);
  }

  /* ---------------- wrap helper ---------------- */

  function wrap(obj, name, fn) {
    if (!obj || typeof obj[name] !== 'function' || obj[name].__nvv) return false;
    var orig = obj[name];
    var w = function () { return fn.call(this, orig, arguments); };
    w.__nvv = true;
    obj[name] = w;
    return true;
  }

  /* ---------------- codex hooks ---------------- */

  var FALL_CHAPTER_VOICE = {
    fall1: 'codex_02', fall2: 'codex_03', fall3: 'codex_04',
    fall4: 'codex_05', fall5: 'codex_06'
  };
  var archiveMilestone = false; // runtime-only; save-neutral

  function onNewEntry(cat, id) {
    var vid = (cat === 's' && FALL_CHAPTER_VOICE[id]) || 'codex_07';
    if (vid === 'codex_07') {
      try {
        var c = SF.Codex.counts();
        if (!archiveMilestone && c && c.total > 0 && c.unlocked / c.total >= 0.5) {
          archiveMilestone = true;
          vid = 'codex_08';
        }
      } catch (e) {}
    }
    playLine(vid);
  }

  function hookCodex() {
    if (!SF.Codex) return;
    // codex_01 when the codex journal opens (render covers the CODEX
    // tab, SF.Codex.open() and the 'C' hotkey).
    wrap(SF.Codex, 'render', function (orig, args) {
      var r = orig.apply(this, args);
      try { playLine('codex_01'); } catch (e) {}
      return r;
    });
    // codex_02..06 on Fall chapter unlocks; codex_07 on any other new
    // entry (unlock* only returns true for genuinely new entries).
    wrap(SF.Codex, 'unlockStory', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { onNewEntry('s', args[0]); } catch (e) {} }
      return r;
    });
    wrap(SF.Codex, 'unlockChar', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { onNewEntry('c', args[1]); } catch (e) {} }
      return r;
    });
    wrap(SF.Codex, 'unlockLore', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { onNewEntry('l', args[0]); } catch (e) {} }
      return r;
    });
    wrap(SF.Codex, 'metNPC', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { onNewEntry('c', args[0]); } catch (e) {} }
      return r;
    });
  }

  /* ---------------- broker hooks ---------------- */

  var lastBoardRender = 0;

  function hookBoard() {
    if (!SF.Quests) return;
    // broker_01 on a fresh quest-board open / refresh — not on
    // re-renders within 2s (e.g. the renderStore call after ACCEPT).
    wrap(SF.Quests, 'renderBoard', function (orig, args) {
      var r = orig.apply(this, args);
      try {
        var now = Date.now();
        if (now - lastBoardRender > 2000) {
          lastBoardRender = now;
          playLine('broker_01');
        }
      } catch (e) {}
      return r;
    });
  }

  // SF.Daily lives in quests.js (daily-contracts phase, appended IIFE).
  // Hook lazily: quests.js loads before campaign.js, but a short retry
  // keeps the wiring correct even if merge order ever changes.
  function hookDaily() {
    if (!window.SF || !SF.Daily || SF.Daily.__nvvHooked) return !!SF.Daily;
    SF.Daily.__nvvHooked = true;
    wrap(SF.Daily, 'accept', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { playLine('broker_02'); } catch (e) {} }
      return r;
    });
    wrap(SF.Daily, 'expireTick', function (orig, args) {
      var r = orig.apply(this, args);
      if (r) { try { playLine('broker_03'); } catch (e) {} }
      return r;
    });
    return true;
  }

  var dailyAttempts = 0;
  var dailyTimer = setInterval(function () {
    try {
      if (hookDaily() || ++dailyAttempts >= 60) clearInterval(dailyTimer);
    } catch (e) { clearInterval(dailyTimer); }
  }, 1000);

  /* ---------------- elite-bounty post watcher ---------------- */

  // SF.EliteContracts exposes no "post" event (replaceContract is
  // private), so watch the public list(): any contract id that was not
  // in the baseline snapshot is a rotation post -> broker_04.
  var eliteBaseline = null;

  function eliteTick() {
    try {
      if (!window.SF || !SF.EliteContracts || typeof SF.EliteContracts.list !== 'function') return;
      var list = SF.EliteContracts.list();
      if (!eliteBaseline) {
        if (!list.length) return; // contracts not seeded yet — not a post
        eliteBaseline = {};
        list.forEach(function (ct) { if (ct && ct.id) eliteBaseline[ct.id] = true; });
        return;
      }
      var posted = false;
      list.forEach(function (ct) {
        if (ct && ct.id && !eliteBaseline[ct.id]) {
          eliteBaseline[ct.id] = true;
          posted = true;
        }
      });
      if (posted) playLine('broker_04');
    } catch (e) { /* watcher must never break the game */ }
  }

  setInterval(eliteTick, 3000);

  /* ---------------- install ---------------- */

  hookCodex();
  hookBoard();
  hookDaily();

  SF.NGPlusVoice = {
    play: playLine,
    ids: Object.keys(LINES),
    _eliteTick: eliteTick,
    _resetEliteBaseline: function () { eliteBaseline = null; },
    _counts: function () { return SF.Codex ? SF.Codex.counts() : null; }
  };
})();

/* ============================================================
 * STARFALL — voice-wiring-v6b phase (2026-10-21)
 *
 * Wires voice-pack-6's New Game+ lines into SF.NGPlus.
 * js/campaign.js ONLY — additive; the base NGPlus block above is
 * untouched except two guarded call sites (marked inline).
 *
 * Voice ids are taken verbatim from
 * phases/voice-pack-6/VOICE-MANIFEST-6.md — no invented ids:
 *   ngplus_offer_01/02 — spoken when the Ash offer dialogue shows
 *                        at cycle 0 (rotated)
 *   ngplus_offer2_01   — spoken when the offer re-arms at cycle >= 1
 *   ngplus_accept_01   — spoken on acceptNGPlus, before the reset
 *
 * Playback: if (SF.Audio && SF.Audio.voice) SF.Audio.voice(id)
 * (guarded, never throws) + subtitle caption reusing the shared
 * #sf-voice-caption element (interrupt pattern, same as the
 * ngplus-voice-wiring / v6 blocks).
 *
 * Save-neutral: no persisted state, no SF.SAVE_VERSION bump.
 *
 * Public surface: SF.NGPlusVoice6 { offer, accept, ids } — test hooks.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.__ngplusV6bWiring) return; // no double install
  SF.__ngplusV6bWiring = true;

  /* line table — ids + caption text per VOICE-MANIFEST-6.md */
  var LINES = {
    'ngplus_offer_01': { n: 'ASH', c: '#7fd4ff', t: "The Fall is over, but the drift goes on. Begin again, captain? New Game Plus.", d: 5.69 },
    'ngplus_offer_02': { n: 'ASH', c: '#7fd4ff', t: "Same stars. Meaner pirates. Keep everything you've earned. Start the next cycle?", d: 5.32 },
    'ngplus_accept_01': { n: 'ASH', c: '#7fd4ff', t: "Cycle one. They'll hit fifty percent harder. So will you.", d: 3.91 },
    'ngplus_offer2_01': { n: 'ASH', c: '#7fd4ff', t: "You beat the harder Fall. Ready for cycle two, legend?", d: 3.57 }
  };

  /* ---------------- caption + playback ---------------- */

  var captionTimer = null;

  function showCaption(v) {
    try {
      var el = document.getElementById('sf-voice-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sf-voice-caption';
        el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);' +
          'max-width:min(86vw,640px);padding:10px 14px;border-radius:10px;' +
          'background:rgba(4,8,18,.82);border:1px solid rgba(127,212,255,.35);' +
          'color:#eaf4ff;font:15px/1.45 system-ui,sans-serif;text-align:center;' +
          'z-index:9999;pointer-events:none;display:none;text-shadow:0 1px 2px #000;';
        document.body.appendChild(el);
      }
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:' + v.c +
        ';margin-bottom:4px;font-weight:700;';
      sp.textContent = v.n;
      var tx = document.createElement('div');
      tx.textContent = v.t;
      el.appendChild(sp); el.appendChild(tx);
      el.style.display = 'block';
      if (captionTimer) clearTimeout(captionTimer);
      captionTimer = setTimeout(function () {
        captionTimer = null;
        try { el.style.display = 'none'; } catch (e) {}
      }, Math.max(1200, v.d * 1000));
    } catch (e) { /* captions must never break the game */ }
  }

  function playLine(id) {
    var v = LINES[id];
    if (!v) return null;
    try {
      if (SF.Audio && SF.Audio.voice) SF.Audio.voice(id);
    } catch (err) { /* voice must never break the game */ }
    showCaption(v);
    return id;
  }

  function pick(prefix, n) {
    return playLine(prefix + '_0' + (1 + Math.floor(Math.random() * n)));
  }

  SF.NGPlusVoice6 = {
    offer: function (cycle) {
      if ((cycle || 0) >= 1) playLine('ngplus_offer2_01');
      else pick('ngplus_offer', 2);
    },
    accept: function () { playLine('ngplus_accept_01'); },
    ids: function () { return Object.keys(LINES); }
  };
})();

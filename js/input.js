/* STARFALL touch-controls-polish phase — input.js
 * Touch: virtual joystick on left half (move), virtual aim stick on right half
 * (dynamic origin; deflecting it aims AND fires — classic twin-stick).
 * Desktop fallback: WASD / arrows + Space. E docks, M opens star map, B boards.
 *
 * touch-controls-polish additions (ADDITIVE hooks only — no refactor of the
 * move/aim/keyboard plumbing above):
 *  1. Deadzone + sensitivity curve on the move stick: deflection below
 *     calib.dz is zeroed, then ((m-dz)/(1-dz))^expo * sens remaps the rest
 *     to [0,1]. Per-device calibration lives in localStorage
 *     'starfall_input_prefs_v1' keyed by device tag (the "input blob",
 *     save-neutral: never touches starfall_save_v1 or SF.SAVE_VERSION).
 *     A noise-floor auto-calibrator watches near-zero stick deflections
 *     while PLAYING and persists dz = clamp(1.5 * p95(noise), 0.05, 0.25).
 *     NOTE: hud.js SF.UX wraps SF.Input.poll and zeroes m < 0.12 after this
 *     file's own curve runs — effective deadzone is max(calib.dz, 0.12).
 *     That wrap is out of this phase's file scope, so it stays as-is.
 *  2. Double-tap dodge: two quick taps (release < 300ms, moved < 26px,
 *     second tap lands < 350ms after the first ended) on the canvas — not
 *     on any .ui-block element — fire a 0.22s dash burst in the direction of
 *     the current move vector, aim direction, or ship facing, with a 3s
 *     cooldown. Suppressed unless SF.Game.state === 'PLAYING' and the
 *     dialogue overlay is hidden (never while a dialog or the station menu
 *     is open). Interaction with afterburner-boost: that phase owns
 *     double-tap-AND-HOLD on the left half; quick double-taps never hold
 *     long enough to engage it, and held double-taps never complete a tap,
 *     so the two gestures do not collide.
 *  3. Contextual FIRE button: grows 15% (scale 1.15) while SF.TargetLock
 *     reports a lock with dist <= TARGET_FIRE_RANGE (1000px ≈ effective
 *     projectile reach for 420–950 px/s at ~1.6s life), shrinks to 0.9 when
 *     idle. transform-origin center, and the button sits bottom-right while
 *     the minimap sits top-right, so the scaled button can never overlap it
 *     (asserted by the smoke test via bounding rects).
 *  4. Haptic taps: dodge triggers a navigator.vibrate pattern, and the FIRE
 *     button press emits a light tap — both through SF.Haptics.play when
 *     available (user setting 'starfall_haptics_v1', default ON, mute-aware)
 *     with a guarded direct-vibrate fallback that re-reads the same
 *     preference key. If a future weapon ever sets SF.Player.weapon.charge,
 *     firing it uses a distinct longer pattern.
 */
window.SF = window.SF || {};

SF.Input = (function () {
  var JOY_RADIUS = 60;
  var AIM_DEADZONE = 0.25; // stick deflection past this counts as aiming

  /* ---------------- touch-controls-polish: calibration blob ---------------- */
  var CAL_KEY = 'starfall_input_prefs_v1';
  var CAL_DEFAULTS = { dz: 0.10, expo: 1.35, sens: 1.0 };

  function deviceTag() {
    var s = '';
    try {
      s = (window.screen ? window.screen.width + 'x' + window.screen.height : '') + '|' +
          (navigator.maxTouchPoints || 0) + '|' + (navigator.userAgent || '');
    } catch (e) { s = 'unknown'; }
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'd' + (h >>> 0).toString(36);
  }
  var DEV_TAG = deviceTag();

  function loadCalib() {
    var c = { dz: CAL_DEFAULTS.dz, expo: CAL_DEFAULTS.expo, sens: CAL_DEFAULTS.sens };
    try {
      var raw = localStorage.getItem(CAL_KEY);
      if (raw) {
        var all = JSON.parse(raw) || {};
        var d = all[DEV_TAG] || {};
        if (typeof d.dz === 'number') c.dz = Math.min(0.4, Math.max(0, d.dz));
        if (typeof d.expo === 'number') c.expo = Math.min(3, Math.max(0.5, d.expo));
        if (typeof d.sens === 'number') c.sens = Math.min(2, Math.max(0.25, d.sens));
      }
    } catch (e) { /* storage unavailable: defaults */ }
    return c;
  }
  var calib = loadCalib();
  function saveCalib() {
    try {
      var raw = localStorage.getItem(CAL_KEY);
      var all = raw ? (JSON.parse(raw) || {}) : {};
      all[DEV_TAG] = { dz: calib.dz, expo: calib.expo, sens: calib.sens };
      localStorage.setItem(CAL_KEY, JSON.stringify(all));
    } catch (e) { /* storage full/blocked */ }
  }

  /* noise-floor auto-calibration: near-zero stick deflections while PLAYING */
  var noiseSamples = [];
  var calibT = 0;
  function observeNoise(m) {
    if (m > 0 && m < 0.18) {
      noiseSamples.push(m);
      if (noiseSamples.length > 240) noiseSamples.shift();
    }
  }
  function autoCalibrate(dt) {
    calibT += dt;
    if (calibT < 10 || noiseSamples.length < 40) return;
    calibT = 0;
    var s = noiseSamples.slice().sort(function (a, b) { return a - b; });
    var p95 = s[Math.floor(s.length * 0.95)];
    var dz = Math.min(0.25, Math.max(0.05, 1.5 * p95));
    if (Math.abs(dz - calib.dz) > 0.01) { calib.dz = dz; saveCalib(); }
    noiseSamples = [];
  }

  /* response curve: deadzone → [0,1] remap → exponent → sensitivity */
  function shapeStick(nx, ny) {
    var m = Math.hypot(nx, ny);
    observeNoise(m);
    if (m < calib.dz || m <= 0) return { x: 0, y: 0 };
    var out = Math.pow((m - calib.dz) / (1 - calib.dz), calib.expo) * calib.sens;
    if (out > 1) out = 1;
    var k = out / m;
    return { x: nx * k, y: ny * k };
  }

  /* ---------------- touch-controls-polish: haptics ---------------- */
  function buzz(pattern) {
    try {
      if (window.SF && SF.Haptics && typeof SF.Haptics.play === 'function') {
        return SF.Haptics.play(pattern); // user setting + mute guarded inside
      }
    } catch (e) {}
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        var on = true;
        try {
          var raw = localStorage.getItem('starfall_haptics_v1');
          if (raw) on = !!JSON.parse(raw).enabled;
        } catch (e2) {}
        if (on) return !!navigator.vibrate(pattern);
      }
    } catch (e) {}
    return false;
  }

  /* ---------------- touch-controls-polish: double-tap dodge ---------------- */
  var DODGE = {
    tapWindowMs: 350,  // max gap between first tap end and second tap start
    tapMaxMs: 300,     // max duration of a single tap
    tapMaxMove: 26,    // px; more movement = a drag, not a tap
    dashLen: 0.22,     // s
    dashMul: 3.0,      // peak velocity multiplier added on top of the stick vector
    cooldown: 3.0      // s
  };
  var dashT = 0, dashDx = 1, dashDy = 0;
  var lastDashAt = -99;
  var lastPollMs = 0;
  var tapTrack = {};   // touch identifier -> {x0, y0, t0}
  var lastTapEnd = -99, lastTapX = 0, lastTapY = 0;

  function nowS() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }
  function dialogueVisible() {
    try {
      var el = document.getElementById('overlay-dialogue');
      return !!(el && !el.classList.contains('hidden'));
    } catch (e) { return false; }
  }
  function dodgeAllowed() {
    if (!window.SF || !SF.Game) return false;
    if (SF.Game.state !== 'PLAYING') return false; // never in station menu / starmap / title
    if (dialogueVisible()) return false;           // never while a dialog is open
    return true;
  }

  /* ---------------- beta2-qkey: quest-log toggle helpers ----------------
   * Root cause of the Q-key death trap: Q only ever OPENED the quest log
   * (keydown set questKey, main.js update() consumed it into openLog()).
   * While the panel was open, frame() was already modal-paused
   * (hail-pause-2), so update() never ran and a second Q press could
   * never be consumed — the panel was click-to-close only, next to WASD.
   * The toggle therefore has to live HERE, in the keydown listener, which
   * fires even while the sim is modal-paused. Open state is read from the
   * hail-pause-2 modal registry first (showOverlay-maintained) with the
   * DOM class as fallback, so panels opened outside the registry (the
   * starmap toggles its class directly) are still seen. */
  function questOverlayOpen() {
    try {
      if (window.SF && SF.Game && typeof SF.Game.modalOpenIds === 'function') {
        if (SF.Game.modalOpenIds().indexOf('overlay-quests') >= 0) return true;
      }
    } catch (e) {}
    try {
      var el = document.getElementById('overlay-quests');
      return !!(el && !el.classList.contains('hidden'));
    } catch (e2) { return false; }
  }
  function anyOverlayOpen() {
    try {
      if (window.SF && SF.Game && typeof SF.Game.modalOpenIds === 'function' &&
          SF.Game.modalOpenIds().length) return true;
    } catch (e) {}
    try { return !!document.querySelector('.overlay:not(.hidden)'); } catch (e2) { return false; }
  }
  function closeQuestLog() {
    try { if (window.SF && SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack(); } catch (e) {}
    try {
      if (window.SF && SF.Quests && typeof SF.Quests.closeLog === 'function') { SF.Quests.closeLog(); return; }
      if (window.SF && SF.Game && typeof SF.Game.hideOverlay === 'function') SF.Game.hideOverlay('overlay-quests');
    } catch (e2) {}
  }
  function dashDirection() {
    var m = Math.hypot(state.mx, state.my);
    if (m > 0.15) return { x: state.mx / m, y: state.my / m };
    if (state.aimActive) return { x: Math.cos(state.aimAngle), y: Math.sin(state.aimAngle) };
    try {
      if (window.SF && SF.Player && typeof SF.Player.angle === 'number') {
        return { x: Math.cos(SF.Player.angle), y: Math.sin(SF.Player.angle) };
      }
    } catch (e) {}
    return { x: 1, y: 0 };
  }
  function triggerDodge() {
    if (!dodgeAllowed()) return false;
    var now = nowS();
    if (now - lastDashAt < DODGE.cooldown) return false; // on cooldown
    var d = dashDirection();
    dashDx = d.x; dashDy = d.y;
    dashT = DODGE.dashLen;
    lastDashAt = now;
    buzz([18, 40, 18]); // dodge haptic: sharp-double tap
    return true;
  }

  /* ---------------- touch-controls-polish: contextual FIRE button ---------------- */
  var TARGET_FIRE_RANGE = 1000; // px ≈ effective projectile reach (420–950 px/s, ~1.6s life)
  var FIRE_SCALE_UP = 1.15, FIRE_SCALE_IDLE = 0.9;
  var fireScaleCur = 1;
  function updateFireButton() {
    if (!fireBtn) return;
    var targeted = false;
    try {
      if (window.SF && SF.TargetLock && typeof SF.TargetLock.state === 'function') {
        var s = SF.TargetLock.state();
        targeted = !!(s && s.locked && s.dist !== null && s.dist <= TARGET_FIRE_RANGE);
      }
    } catch (e) {}
    var want = targeted ? FIRE_SCALE_UP : FIRE_SCALE_IDLE;
    if (Math.abs(want - fireScaleCur) > 0.001) {
      fireScaleCur = want;
      fireBtn.style.transformOrigin = 'center';
      fireBtn.style.transform = 'scale(' + want + ')';
    }
  }

  var state = {
    mx: 0, my: 0,          // move vector, -1..1
    ax: 0, ay: 0,          // aim vector, -1..1 (right stick)
    aimActive: false,
    aimAngle: 0,
    firing: false,
    dockKey: false,        // set on E keydown, consumed by main
    mapKey: false,         // set on M keydown, consumed by main
    boardKey: false,       // set on B keydown, consumed by main
    newsKey: false         // planets-facilities: set on N keydown, opens the news wire
  };

  var joyId = null, joyOX = 0, joyOY = 0;
  var aimId = null, aimOX = 0, aimOY = 0;
  var keys = {};
  var fireBtn = null;
  var joyBase = null, joyKnob = null;
  var aimBase = null, aimKnob = null;

  function setJoystickVisual(active, dx, dy) {
    if (!joyBase) return;
    if (!active) { joyBase.classList.add('hidden'); return; }
    joyBase.classList.remove('hidden');
    joyBase.style.left = (joyOX - JOY_RADIUS) + 'px';
    joyBase.style.top = (joyOY - JOY_RADIUS) + 'px';
    var cl = Math.hypot(dx, dy) || 1;
    var k = Math.min(cl, JOY_RADIUS) / cl;
    joyKnob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
  }

  function setAimVisual(active, dx, dy) {
    if (!aimBase) return;
    if (!active) { aimBase.classList.add('hidden'); return; }
    aimBase.classList.remove('hidden');
    aimBase.style.left = (aimOX - JOY_RADIUS) + 'px';
    aimBase.style.top = (aimOY - JOY_RADIUS) + 'px';
    var cl = Math.hypot(dx, dy) || 1;
    var k = Math.min(cl, JOY_RADIUS) / cl;
    aimKnob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
  }

  function aimRelease() {
    aimId = null; state.ax = 0; state.ay = 0;
    state.aimActive = false;
    setAimVisual(false, 0, 0);
  }

  function onTouchStart(e) {
    SF.Audio.unlock();
    var t0 = nowS() * 1000;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      // ignore touches that began on UI buttons/overlays
      var el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest && el.closest('.ui-block')) continue;
      tapTrack[t.identifier] = { x0: t.clientX, y0: t.clientY, t0: t0 }; // dodge tap tracking
      if (t.clientX < window.innerWidth * 0.5 && joyId === null) {
        joyId = t.identifier;
        joyOX = t.clientX; joyOY = t.clientY;
        setJoystickVisual(true, 0, 0);
      } else if (t.clientX >= window.innerWidth * 0.5 && aimId === null) {
        aimId = t.identifier;
        aimOX = t.clientX; aimOY = t.clientY;
        setAimVisual(true, 0, 0);
      }
    }
  }

  function onTouchMove(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === joyId) {
        var dx = t.clientX - joyOX, dy = t.clientY - joyOY;
        var len = Math.hypot(dx, dy);
        var cl = Math.min(len, JOY_RADIUS);
        var sh = { x: 0, y: 0 };
        if (len > 0.001) sh = shapeStick(dx / len * (cl / JOY_RADIUS), dy / len * (cl / JOY_RADIUS));
        state.mx = sh.x; state.my = sh.y; // deadzone + sensitivity curve applied
        setJoystickVisual(true, dx, dy);
        if (e.cancelable) e.preventDefault();
      } else if (t.identifier === aimId) {
        var ax = t.clientX - aimOX, ay = t.clientY - aimOY;
        var alen = Math.hypot(ax, ay);
        var acl = Math.min(alen, JOY_RADIUS);
        if (alen > 0.001) { state.ax = ax / alen * (acl / JOY_RADIUS); state.ay = ay / alen * (acl / JOY_RADIUS); }
        else { state.ax = 0; state.ay = 0; }
        var mag = Math.hypot(state.ax, state.ay);
        state.aimActive = mag > AIM_DEADZONE;
        if (state.aimActive) state.aimAngle = Math.atan2(state.ay, state.ax);
        setAimVisual(true, ax, ay);
        if (e.cancelable) e.preventDefault();
      }
    }
  }

  function onTouchEnd(e) {
    var nowMs = nowS() * 1000;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var id = e.changedTouches[i].identifier;
      var tr = tapTrack[id];
      if (tr) {
        delete tapTrack[id];
        var dur = nowMs - tr.t0;
        var t = e.changedTouches[i];
        var moved = Math.hypot(t.clientX - tr.x0, t.clientY - tr.y0);
        if (dur < DODGE.tapMaxMs && moved < DODGE.tapMaxMove) {
          // a tap: double-tap = second tap starts within the window
          if (tr.t0 - lastTapEnd < DODGE.tapWindowMs && lastTapEnd > 0) triggerDodge();
          lastTapEnd = nowMs; lastTapX = t.clientX; lastTapY = t.clientY;
        }
      }
      if (id === joyId) {
        joyId = null; state.mx = 0; state.my = 0;
        setJoystickVisual(false, 0, 0);
      }
      if (id === aimId) aimRelease();
    }
  }

  function pollKeys() {
    var x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    if (x !== 0 || y !== 0) {
      var l = Math.hypot(x, y); state.mx = x / l; state.my = y / l;
    } else if (joyId === null) {
      state.mx = 0; state.my = 0;
    }
    state.firing = !!keys.Space || state._touchFiring || state.aimActive;
  }

  function isWeaponCharged() {
    try {
      return !!(window.SF && SF.Player && SF.Player.weapon && SF.Player.weapon.charge === true);
    } catch (e) { return false; } // no charged-weapon mechanic exists yet; defensive
  }

  return {
    mx: 0, my: 0, firing: false,
    ax: 0, ay: 0, aimActive: false, aimAngle: 0,
    dockKey: false, mapKey: false, boardKey: false,

    // encounter-pause-1: drop all held TOUCH-derived input state (stick,
    // aim, fire, dash, tap tracking) when a blocking modal closes, so a
    // touch that started or ended behind the modal can never come back as
    // a stuck stick or stuck fire button. Keyboard state is deliberately
    // NOT cleared: keys still physically held re-derive on the next poll.
    clearHeld: function () {
      joyId = null; aimId = null;
      state.mx = 0; state.my = 0; state.ax = 0; state.ay = 0;
      state.aimActive = false; state.firing = false; state._touchFiring = false;
      dashT = 0; tapTrack = {};
      setJoystickVisual(false, 0, 0); setAimVisual(false, 0, 0);
    },

    init: function () {
      var self = this;
      fireBtn = document.getElementById('btn-fire');
      joyBase = document.getElementById('joystick');
      joyKnob = document.getElementById('joy-knob');
      aimBase = document.getElementById('aimstick');
      aimKnob = document.getElementById('aim-knob');

      var canvas = document.getElementById('game');
      canvas.addEventListener('touchstart', onTouchStart, { passive: true });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: true });
      canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });

      if (fireBtn) {
        fireBtn.addEventListener('touchstart', function (e) {
          SF.Audio.unlock(); state._touchFiring = true;
          buzz(isWeaponCharged() ? [25, 30, 40] : [10]); // fire haptic tap
          if (e.cancelable) e.preventDefault();
        }, { passive: false });
        fireBtn.addEventListener('touchend', function () { state._touchFiring = false; }, { passive: true });
        fireBtn.addEventListener('touchcancel', function () { state._touchFiring = false; }, { passive: true });
        // mouse fallback for the fire button (desktop testing)
        fireBtn.addEventListener('mousedown', function () { state._touchFiring = true; });
        window.addEventListener('mouseup', function () { state._touchFiring = false; });
      }

      window.addEventListener('keydown', function (e) {
        keys[e.code] = true;
        if (e.code === 'KeyE') self.dockKey = true;
        if (e.code === 'KeyM') self.mapKey = true;
        if (e.code === 'KeyB') self.boardKey = true;
        // beta2-qkey: Q toggles the quest log / codex panel, J is the same
        // toggle on a WASD-safe key (J was unbound anywhere in the tree),
        // and Esc closes the panel (the skills-panel convention, hud.js).
        // A press while the panel is open closes it synchronously here —
        // it must NOT set questKey, or the queued flag would reopen the
        // panel on the first frame after any close. A press while some
        // OTHER panel is open is swallowed for the same reason: the old
        // code queued questKey behind the modal and the log popped open
        // the moment that modal closed (e.g. Q pressed on the starmap,
        // whose branch never consumed questKey). Repeats are ignored so
        // holding Q/J cannot flicker the panel open-then-closed.
        if (e.code === 'KeyQ' || e.code === 'KeyJ') {
          if (e.repeat) return;
          if (questOverlayOpen()) { closeQuestLog(); return; }
          if (!anyOverlayOpen()) self.questKey = true;
          return;
        }
        if (e.code === 'Escape' && questOverlayOpen()) { closeQuestLog(); return; }
        if (e.code === 'KeyN') self.newsKey = true; // planets-facilities
        if (e.code === 'Space') { SF.Audio.unlock(); if (e.cancelable) e.preventDefault(); }
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.code) >= 0 && e.cancelable) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { keys[e.code] = false; });
      window.addEventListener('blur', function () {
        keys = {}; state._touchFiring = false; aimRelease();
        dashT = 0; tapTrack = {}; // touch-controls-polish: reset dash + taps on blur
      });

      // prevent pinch-zoom / double-tap zoom gestures
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
      document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
      document.addEventListener('contextmenu', function (e) {
        if (e.target && e.target.id === 'game') e.preventDefault();
      });
    },

    // called once per frame before update: merges touch + keyboard
    poll: function () {
      pollKeys();
      this.mx = state.mx; this.my = state.my; this.firing = state.firing;
      this.ax = state.ax; this.ay = state.ay;
      this.aimActive = state.aimActive; this.aimAngle = state.aimAngle;
      // touch-controls-polish: dash burst on top of the move vector
      var nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var dt = lastPollMs ? Math.min(0.1, Math.max(0, (nowMs - lastPollMs) / 1000)) : 0.016;
      lastPollMs = nowMs;
      if (dashT > 0) {
        dashT = Math.max(0, dashT - dt);
        var f = dashT / DODGE.dashLen;
        this.mx += dashDx * DODGE.dashMul * f;
        this.my += dashDy * DODGE.dashMul * f;
        this.dashActive = true;
      } else {
        this.dashActive = false;
      }
      this.dashCooldown = Math.max(0, DODGE.cooldown - (nowS() - lastDashAt));
      autoCalibrate(dt);       // noise-floor deadzone calibration, ~10s cadence
      updateFireButton();      // contextual FIRE sizing, DOM write only on change
    },

    /* touch-controls-polish: calibration / dodge introspection + test API */
    touch: {
      deviceTag: function () { return DEV_TAG; },
      calib: function () { return { dz: calib.dz, expo: calib.expo, sens: calib.sens }; },
      setCalib: function (c) {
        if (c && typeof c.dz === 'number') calib.dz = Math.min(0.4, Math.max(0, c.dz));
        if (c && typeof c.sens === 'number') calib.sens = Math.min(2, Math.max(0.25, c.sens));
        if (c && typeof c.expo === 'number') calib.expo = Math.min(3, Math.max(0.5, c.expo));
        saveCalib(); return this.calib();
      },
      shape: function (nx, ny) { return shapeStick(nx, ny); },
      dodge: function () { return triggerDodge(); }, // force a dodge (tests); honors suppression + cooldown
      dodgeState: function () {
        return { dashT: dashT, dashActive: dashT > 0,
                 cooldownLeft: Math.max(0, DODGE.cooldown - (nowS() - lastDashAt)),
                 allowed: dodgeAllowed(), params: { dashLen: DODGE.dashLen,
                 dashMul: DODGE.dashMul, cooldown: DODGE.cooldown } };
      },
      constants: function () {
        return { targetFireRange: TARGET_FIRE_RANGE, fireScaleUp: FIRE_SCALE_UP,
                 fireScaleIdle: FIRE_SCALE_IDLE, joyRadius: JOY_RADIUS };
      }
    },

    consumeDockKey: function () { var v = this.dockKey; this.dockKey = false; return v; },
    consumeMapKey: function () { var v = this.mapKey; this.mapKey = false; return v; },
    consumeBoardKey: function () { var v = this.boardKey; this.boardKey = false; return v; },
    consumeNewsKey: function () { var v = this.newsKey; this.newsKey = false; return v; }, // planets-facilities
    consumeQuestKey: function () { var v = this.questKey; this.questKey = false; return v; }
  };
})();

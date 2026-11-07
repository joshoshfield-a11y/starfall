/* ============================================================
 * STARFALL — planets-facilities phase: SF.News
 *
 * A galaxy-events news feed. Events are pushed from real game state
 * (bounty claims, faction standing shifts, market spikes, derelict
 * discoveries, job fallout) plus seeded ambient rumors on dock.
 * Rendered as a HUD ticker (marquee) + a full NEWS overlay screen.
 * State persists via SF.Player.news {feed: [{t, text}], seen}.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  var MAX_FEED = 40;

  var AMBIENT = [
    'Freighter convoy docked at Haven Dock, holds full of off-world luxuries.',
    'Compact patrols doubled near the Solace relay after last week\u2019s raid.',
    'Drifter miners struck a rich ore seam past the Shatters. Claims are selling fast.',
    'An Ember Pact warlord was seen drinking on Cinderfall. Nobody asked questions.',
    'Black-market prices volatile across the Drift — fences blame a Compact sweep.',
    'Ghost signals reported near Deadlight. Scavengers call them \u201Cthe quiet fleet\u201D.',
    'Aegis Citadel announced new requisition contracts for loyal captains.',
    'Karavan Prime\u2019s market flooded with cheap electronics. Sellers nervous.',
    'Ember recruiters promising double shares for \u201Cpatriots of the Pact\u201D.',
    'Old spacers swear the anomaly in the Drift is humming louder this week.'
  ];

  function feed() {
    var p = SF.Player;
    if (!p.news) p.news = { feed: [], seen: 0 };
    return p.news;
  }

  function fmtTime(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var News = {

    /* Record an event. Source strings keep pushes greppable. */
    push: function (text) {
      var n = feed();
      n.feed.push({ t: Date.now(), text: text });
      if (n.feed.length > MAX_FEED) n.feed.splice(0, n.feed.length - MAX_FEED);
      this._ticker();
      if (SF.Save) SF.Save.save();
    },

    latest: function (n) {
      var f = feed().feed;
      return f.slice(Math.max(0, f.length - (n || 5))).reverse();
    },

    all: function () { return feed().feed.slice().reverse(); },

    /* Seeded on dock: 30% chance of one ambient wire story. */
    ambient: function () {
      if (Math.random() < 0.30) {
        this.push('\uD83D\uDCF0 ' + AMBIENT[Math.floor(Math.random() * AMBIENT.length)]);
      }
    },

    /* ---- HUD ticker ---- */
    _ticker: function () {
      var el = document.getElementById('news-ticker-inner');
      if (!el) return;
      var items = this.latest(3).map(function (e) { return e.text; });
      if (!items.length) items = ['\uD83D\uDCF0 WELCOME TO THE GALACTIC WIRE — events across the sector appear here.'];
      var html = items.join(' \u25C6 ') + ' \u25C6 ';
      el.textContent = html;
      el.innerHTML = el.textContent; // plain text, no markup
      // restart the marquee so fresh items scroll
      el.classList.remove('ticker-run');
      void el.offsetWidth;
      el.classList.add('ticker-run');
    },

    paint: function () { this._ticker(); },

    /* ---- news overlay screen ---- */
    open: function () {
      var body = document.getElementById('news-body');
      body.innerHTML = '';
      var evs = this.all();
      if (!evs.length) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.textContent = 'The wire is quiet. Fly, fight, trade — make some news.';
        body.appendChild(none);
      }
      evs.forEach(function (e) {
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML = '<div class="store-info"><div><div class="store-desc">' +
          '<span class="dim">[' + fmtTime(e.t) + ']</span> ' + e.text + '</div></div></div>';
        body.appendChild(row);
      });
      var n = feed();
      n.seen = n.feed.length;
      SF.Game.showOverlay('overlay-news');
    },

    close: function () { SF.Game.hideOverlay('overlay-news'); }
  };

  SF.News = News;
})();

/* ============================================================
 * news-events-v2 phase (2026-10-19): SF.Events — timed galaxy events
 * announced through the news wire, with real gameplay effects.
 *
 * Events:
 *   pirate_surge : hostile spawn rate x2 in one system for 10 minutes
 *   trade_boom   : +25% sell prices in one system for 10 minutes
 *   crackdown    : customs scan chance x1.5 in one system for 10 minutes
 *
 * Presentation: wire announcement + a live countdown strip in the
 * ticker, a banner on start and on end, and small event icons in the HUD
 * (runtime DOM — index.html is outside this phase's file scope).
 *
 * Rules: max 2 concurrent events; new-event rolls favor the player's
 * current system; durations tick down in wall-clock seconds while the
 * game is live (PLAYING/DOCKED) and the tab is visible.
 *
 * RUNTIME STATE ONLY, SAVE-NEUTRAL: active events are never written to
 * the save blob; SF.SAVE_VERSION is not touched. (Event start/end items
 * ride the ordinary news feed, which persists like any news.)
 *
 * Gameplay hooks (additive, idempotent, deferred until the target module
 * exists at parse time):
 *   SF.Encounters.tick  -> encounter dt accelerated by spawnRateMul(sys)
 *   SF.Trading.price    -> sell side x1.25 during a local trade boom
 *   SF.Customs.chance   -> total x1.5 during a local crackdown
 *   SF.HUD.update       -> paints the event icon cluster
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  SF.EVENT_TYPES = {
    pirate_surge: { name: 'PIRATE SURGE', icon: '\u2620', dur: 600, color: '#ff5e3a',
      startText: 'Hostile spawn rates DOUBLED' },
    trade_boom:   { name: 'TRADE BOOM', icon: '\uD83D\uDCB0', dur: 600, color: '#3ddc5f',
      startText: 'All sell prices +25%' },
    crackdown:    { name: 'FACTION CRACKDOWN', icon: '\uD83D\uDE94', dur: 600, color: '#3fa9ff',
      startText: 'Customs scans far more likely' }
  };
  var TYPE_IDS = ['pirate_surge', 'trade_boom', 'crackdown'];

  /* news-event-voice-wiring (2026-10-20): voice-pack-2 anchor lines wired to
   * galaxy event start/end. Ids + durations confirmed against
   * phases/voice-pack-2/VOICE-MANIFEST-2.md; line text from gen/lines.csv.
   * news_*_2 (mid-event) lines are deliberately NOT wired — the mid slot is
   * reserved for a future phase that fires a midpoint update. Save-neutral. */
  var VOICE_ANCHOR = {
    pirate_surge: {
      intro: { id: 'news_surge_1', d: 4.10,
        text: 'Breaking: pirate surge reported across the system. Bounties up, risk tripled.' },
      end:   { id: 'news_surge_3', d: 4.52,
        text: 'The surge is spent. Lanes are clearing, pilots. Bounty desks report heavy traffic.' }
    },
    trade_boom: {
      intro: { id: 'news_boom_1', d: 4.32,
        text: 'Trade boom in the system! Sell prices up across every station. Haulers, move!' },
      end:   { id: 'news_boom_3', d: 3.51,
        text: 'The trade boom cools. Prices settle. Hope you sold high.' }
    },
    crackdown: {
      intro: { id: 'news_crackdown_1', d: 4.51,
        text: 'Faction crackdown underway. Customs scans are far more likely. Keep papers ready.' },
      end:   { id: 'news_crackdown_3', d: 2.88,
        text: 'The crackdown lifts. Customs waves you through with a nod.' }
    }
  };

  /* tunables, kept here (not data.js) so the whole event system stays in
   * this phase's single file. */
  var CFG = {
    maxConcurrent: 2,
    surgeSpawnMul: 2.0,   // pirate_surge: encounter timer acceleration
    boomSellMul: 1.25,    // trade_boom: sell-side price multiplier
    crackScanMul: 1.5,    // crackdown: customs chance multiplier
    homeBias: 0.65,       // new events land in the player's system this often
    rollEvery: [75, 150], // seconds between scheduler rolls
    rollChance: 0.45      // chance a roll actually starts an event
  };

  var active = []; // [{type, systemId, remaining, total}]
  var nextRollIn = 100;
  var hooked = false;
  var bannerTimer = null;

  function sysName(id) {
    var s = SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id];
    return s ? s.name : id;
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function find(type, systemId) {
    for (var i = 0; i < active.length; i++) {
      if (active[i].type === type && active[i].systemId === systemId) return active[i];
    }
    return null;
  }

  /* ---------------- presentation: DOM (all runtime-created) ---------------- */

  function injectCSS() {
    if (document.getElementById('events-css')) return;
    var css = document.createElement('style');
    css.id = 'events-css';
    css.textContent =
      '#event-banner{position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);' +
      'z-index:9600;pointer-events:none;text-align:center;padding:18px 30px;' +
      'background:rgba(4,8,18,.93);border:2px solid #ffd23f;border-radius:14px;' +
      'box-shadow:0 0 32px rgba(255,210,63,.35);max-width:88vw}' +
      '#event-banner .etitle{font:bold 26px monospace;letter-spacing:2px;margin-bottom:6px}' +
      '#event-banner .esub{font:15px monospace;color:#dfe9ff}' +
      '#event-icons{position:fixed;top:100px;right:10px;z-index:8000;' +
      'display:flex;flex-direction:column;gap:6px;pointer-events:none}' +
      '.evi{display:flex;align-items:center;gap:6px;background:rgba(4,8,18,.85);' +
      'border:1px solid #2a3a5f;border-radius:8px;padding:4px 8px;' +
      'font:bold 13px monospace;color:#fff;white-space:nowrap}' +
      '.evi .eico{font-size:16px}' +
      '#news-events-live{position:absolute;left:0;top:0;bottom:0;display:flex;' +
      'align-items:center;gap:10px;padding:0 10px;z-index:2;' +
      'background:rgba(4,8,18,.95);border-right:1px solid #2a3a5f;' +
      'font:bold 12px monospace;white-space:nowrap}';
    document.head.appendChild(css);
  }

  function showBanner(title, sub, color) {
    injectCSS();
    var b = document.getElementById('event-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'event-banner';
      b.innerHTML = '<div class="etitle"></div><div class="esub"></div>';
      document.body.appendChild(b);
    }
    b.querySelector('.etitle').textContent = title;
    b.querySelector('.etitle').style.color = color || '#ffd23f';
    b.querySelector('.esub').textContent = sub || '';
    b.style.borderColor = color || '#ffd23f';
    b.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.classList.add('hidden'); }, 4500);
  }

  /* live countdown strip pinned to the left of the ticker (updates without
   * restarting the marquee animation) */
  function paintLive() {
    injectCSS();
    var tick = document.getElementById('news-ticker');
    if (!tick) return;
    var live = document.getElementById('news-events-live');
    if (!active.length) { if (live) live.classList.add('hidden'); return; }
    if (!live) {
      live = document.createElement('div');
      live.id = 'news-events-live';
      tick.appendChild(live);
    }
    live.classList.remove('hidden');
    var html = active.map(function (e) {
      var d = SF.EVENT_TYPES[e.type];
      return '<span style="color:' + d.color + '">' + d.icon + ' ' + d.name +
        ' · ' + sysName(e.systemId) + ' ' + fmtClock(e.remaining) + '</span>';
    }).join('<span style="color:#2a3a5f"> ◆ </span>');
    if (live._h !== html) { live._h = html; live.innerHTML = html; }
  }

  /* HUD icon cluster, painted from the wrapped SF.HUD.update */
  function paintIcons() {
    injectCSS();
    var box = document.getElementById('event-icons');
    if (!active.length) { if (box) box.classList.add('hidden'); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'event-icons';
      document.body.appendChild(box);
    }
    box.classList.remove('hidden');
    var html = active.map(function (e) {
      var d = SF.EVENT_TYPES[e.type];
      var title = d.name + ' — ' + sysName(e.systemId) + ': ' + d.startText +
        ' (' + fmtClock(e.remaining) + ' left)';
      return '<span class="evi" title="' + title.replace(/"/g, '&quot;') + '">' +
        '<span class="eico" style="color:' + d.color + '">' + d.icon + '</span>' +
        '<span>' + fmtClock(e.remaining) + '</span></span>';
    }).join('');
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
  }

  /* ---------------- event lifecycle ---------------- */

  /* voice-pack-2 news anchor: guarded SF.Audio.voice + subtitle caption
   * reusing the campaign.js caption pattern (own element id, same visual
   * style, so the two never collide). Voice must never break events. */
  var newsCapEl = null;
  var newsCapTimer = null;

  function ensureNewsCaption() {
    if (newsCapEl) return newsCapEl;
    var el = document.createElement('div');
    el.id = 'sf-news-voice-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);' +
      'max-width:min(86vw,640px);padding:10px 14px;border-radius:10px;' +
      'background:rgba(4,8,18,.82);border:1px solid rgba(255,210,63,.45);' +
      'color:#eaf4ff;font:15px/1.45 system-ui,sans-serif;text-align:center;' +
      'z-index:9999;pointer-events:none;display:none;text-shadow:0 1px 2px #000;';
    document.body.appendChild(el);
    newsCapEl = el;
    return el;
  }

  function showNewsCaption(line) {
    try {
      var el = ensureNewsCaption();
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:#ffd23f;' +
        'margin-bottom:4px;font-weight:700;';
      sp.textContent = 'GALACTIC WIRE';
      var tx = document.createElement('div');
      tx.textContent = line.text;
      el.appendChild(sp); el.appendChild(tx);
      el.style.display = 'block';
      if (newsCapTimer) { clearTimeout(newsCapTimer); newsCapTimer = null; }
      newsCapTimer = setTimeout(function () { el.style.display = 'none'; },
        Math.max(2000, line.d * 1000 + 400));
    } catch (e) { /* caption must never break events */ }
  }

  function playAnchor(type, slot) {
    var pack = VOICE_ANCHOR[type];
    if (!pack) return;
    var line = pack[slot];
    if (!line) return;
    try {
      if (window.SF && SF.Audio && SF.Audio.voice) SF.Audio.voice(line.id);
    } catch (e) { /* voice must never break events */ }
    showNewsCaption(line);
  }

  function start(type, systemId, durSec) {
    var def = SF.EVENT_TYPES[type];
    if (!def || !SF.SYSTEM_BY_ID[systemId]) return false;
    if (active.length >= CFG.maxConcurrent) return false;
    if (find(type, systemId)) return false;
    var dur = (typeof durSec === 'number' && durSec > 0) ? durSec : def.dur;
    active.push({ type: type, systemId: systemId, remaining: dur, total: dur });
    showBanner(def.icon + ' ' + def.name,
      sysName(systemId) + ' — ' + def.startText + ' (' + fmtClock(dur) + ')', def.color);
    if (SF.News) SF.News.push('\uD83D\uDCF0 ' + def.icon + ' GALACTIC WIRE: ' + def.name +
      ' in ' + sysName(systemId) + ' — ' + def.startText + '.');
    playAnchor(type, 'intro');
    paintLive();
    return true;
  }

  function expire(ev) {
    var i = active.indexOf(ev);
    if (i >= 0) active.splice(i, 1);
    var def = SF.EVENT_TYPES[ev.type];
    showBanner('\u2713 ' + def.name + ' ENDED',
      sysName(ev.systemId) + ' returns to normal.', '#9db8dd');
    if (SF.News) SF.News.push('\uD83D\uDCF0 ' + def.icon + ' ' + def.name +
      ' in ' + sysName(ev.systemId) + ' has ended.');
    playAnchor(ev.type, 'end');
    paintLive();
  }

  function pickSystem() {
    var cur = (SF.Game && SF.Game.systemId) || 'solace';
    if (Math.random() < CFG.homeBias) return cur;
    var others = ['solace', 'drift', 'ember'].filter(function (s) { return s !== cur; });
    return others[Math.floor(Math.random() * others.length)];
  }

  function schedulerTick() {
    if (active.length >= CFG.maxConcurrent) return;
    nextRollIn -= 1;
    if (nextRollIn > 0) return;
    nextRollIn = CFG.rollEvery[0] + Math.random() * (CFG.rollEvery[1] - CFG.rollEvery[0]);
    if (Math.random() > CFG.rollChance) return;
    /* pick an event type not already running in the target system */
    var sys = pickSystem();
    var opts = TYPE_IDS.filter(function (t) { return !find(t, sys); });
    if (!opts.length) return;
    start(opts[Math.floor(Math.random() * opts.length)], sys);
  }

  function countdownTick() {
    var changed = false;
    for (var i = active.length - 1; i >= 0; i--) {
      active[i].remaining -= 1;
      changed = true;
      if (active[i].remaining <= 0) expire(active[i]);
    }
    if (changed) { paintLive(); }
    schedulerTick();
  }

  /* ---------------- additive gameplay hooks ---------------- */

  function wrapMethod(obj, name, fn) {
    if (!obj || !obj[name]) return false;
    if (obj[name]._evWrapped) return true;
    var orig = obj[name];
    if (typeof orig !== 'function') return false;
    var w = function () {
      var args = Array.prototype.slice.call(arguments);
      return fn.call(this, orig, args);
    };
    w._evWrapped = true;
    obj[name] = w;
    return true;
  }

  function hookAll() {
    if (hooked || !window.SF) return;
    var ok = true;
    if (SF.Encounters) {
      ok = wrapMethod(SF.Encounters, 'tick', function (orig, args) {
        /* pirate surge: the encounter clock runs faster in the surge system */
        var sys = (SF.Game && SF.Game.systemId) || 'solace';
        return orig.call(this, args[0] * SF.Events.spawnRateMul(sys));
      }) && ok;
    }
    if (SF.Trading) {
      ok = wrapMethod(SF.Trading, 'price', function (orig, args) {
        var p = orig.apply(this, args);
        /* trade boom: +25% on the sell side in the boom system */
        if (args[2] === 'sell' && SF.Events.sellPriceMul() > 1) {
          p = Math.floor(p * SF.Events.sellPriceMul());
        }
        return p;
      }) && ok;
    }
    if (SF.Customs) {
      ok = wrapMethod(SF.Customs, 'chance', function (orig, args) {
        var r = orig.apply(this, args);
        /* crackdown: customs scans far more likely in the crackdown system */
        var m = SF.Events.scanMul((SF.Game && SF.Game.systemId) || 'solace');
        if (m > 1 && r && typeof r.total === 'number') {
          r.total = Math.min(1, Math.max(0, r.total * m));
        }
        return r;
      }) && ok;
    }
    if (SF.HUD) {
      ok = wrapMethod(SF.HUD, 'update', function (orig, args) {
        var r = orig.apply(this, args);
        try { paintIcons(); } catch (e) {}
        return r;
      }) && ok;
    }
    hooked = ok;
    return ok;
  }

  /* ---------------- public API ---------------- */

  var Events = {
    /* all live events: [{type, systemId, remaining, total}] */
    active: function () { return active.map(function (e) {
      return { type: e.type, systemId: e.systemId, remaining: e.remaining, total: e.total };
    }); },

    /* test hook: force-start an event. durSec optional (default 600). */
    force: function (type, systemId, durSec) {
      injectCSS();
      return start(type, systemId, durSec);
    },

    /* test hook: end everything immediately, no banners. */
    clearAll: function () { active.length = 0; paintLive(); paintIcons(); },

    /* effect multipliers, consulted by the gameplay hooks */
    spawnRateMul: function (sysId) {
      return find('pirate_surge', sysId) ? CFG.surgeSpawnMul : 1;
    },
    sellPriceMul: function () {
      var sys = (SF.Game && SF.Game.systemId) || 'solace';
      return find('trade_boom', sys) ? CFG.boomSellMul : 1;
    },
    scanMul: function (sysId) {
      return find('crackdown', sysId) ? CFG.crackScanMul : 1;
    },

    config: function () { return CFG; },

    /* test hook: which voice line (id/text/duration) plays for an event at
     * a lifecycle slot ('intro' | 'end'); null for unknown type/slot. */
    _voiceFor: function (type, slot) {
      var pack = VOICE_ANCHOR[type];
      if (!pack || !pack[slot]) return null;
      var l = pack[slot];
      return { id: l.id, text: l.text, d: l.d };
    },

    _state: function () { return { active: this.active(), hooked: hooked, nextRollIn: nextRollIn }; },
    _tick: countdownTick, // test hook
    _hook: hookAll       // test hook
  };

  SF.Events = Events;

  /* ---------------- boot ---------------- */

  function boot() {
    injectCSS();
    hookAll();
    if (hooked) return;
    /* SF.Customs / SF.HUD load after js/news.js — retry until they exist. */
    var tries = 0;
    var iv = setInterval(function () {
      if (hookAll() || ++tries > 120) clearInterval(iv);
    }, 500);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
  }

  /* scheduler: wall-clock 1s, ticks only while the game is live and visible */
  if (typeof setInterval !== 'undefined') {
    setInterval(function () {
      try {
        if (typeof document !== 'undefined' && document.hidden) return;
        var st = window.SF && SF.Game && SF.Game.state;
        if (st !== 'PLAYING' && st !== 'DOCKED') return;
        countdownTick();
      } catch (e) {}
    }, 1000);
  }
})();

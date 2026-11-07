/* ============================================================
 * STARFALL — Phase 4: Factions & Karma
 *
 * Three factions, a karma axis, standing shifts from player acts,
 * price multipliers, and patrol hostility thresholds.
 *
 * faction-warfare phase (2026-10-19): TERRITORY CONTROL.
 * Per-system x faction control (0-100 each), majority holder grants a
 * system perk, flips make the news. Stored additively on the existing
 * factions blob (P.factions.territory) — SAVE-NEUTRAL, no SAVE_VERSION
 * bump; defensive reads rebuild defaults for old saves.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  // ---------- faction defs ----------
  var FACTIONS = [
    { id: 'compact',  name: 'Solar Compact', short: 'COM', color: '#4da3ff',
      blurb: 'Order through law. Their patrols keep the shipping lanes safe.' },
    { id: 'drifters', name: 'Free Drifters', short: 'DFT', color: '#3ddc5f',
      blurb: 'Independent crews and miners. They remember a favor.' },
    { id: 'ember',    name: 'Ember Pact',    short: 'EMB', color: '#ff5e3a',
      blurb: 'A militant syndicate burning a path through the frontier.' }
  ];
  var BY_ID = {};
  FACTIONS.forEach(function (f) { BY_ID[f.id] = f; });
  SF.FACTION_LIST = FACTIONS;
  SF.FACTION_BY_ID = BY_ID;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Standing lives on the player blob: SF.Player.factionState {compact, drifters, ember}
  function P() { return SF.Player; }

  // ---------- territory warfare (faction-warfare phase) ----------
  // Initial holders: Compact -> Solace, Drifters -> Drift, Ember Pact -> Ember.
  var HOLDERS = { solace: 'compact', drift: 'drifters', ember: 'ember' };

  // Tuning: keep in one place so balance passes can find it.
  var WAR = {
    holderStart: 60,  // control value for the initial holder
    otherStart: 20,   // control value for the other two factions
    killDelta: -2,    // per faction-ship kill, in the current system
    questDelta: 3,    // per quest turn-in for a faction, in the current system
    tradePer1k: 0.5   // control gained by the local faction per 1000cr sold
  };

  // The territory blob lives at P.factions.territory:
  //   { <systemId>: { compact: n, drifters: n, ember: n } }
  // Additive with defensive reads: missing/corrupt rows are rebuilt from
  // defaults in place; old saves without the blob get it on first access and
  // serialize() writes it back out. No migrate function, no version bump.
  function _territory() {
    var pl;
    try { pl = P(); } catch (e) { return null; }
    var fs;
    try { fs = pl ? pl.factionState : null; } catch (e) { return null; }
    if (!fs) return null;
    if (!fs.territory || typeof fs.territory !== 'object') fs.territory = {};
    var t = fs.territory;
    if (!window.SF || !SF.SYSTEMS) return t;
    SF.SYSTEMS.forEach(function (sys) {
      var row = t[sys.id];
      if (!row || typeof row !== 'object') row = t[sys.id] = {};
      FACTIONS.forEach(function (f) {
        var v = row[f.id];
        if (!isFinite(v)) v = (HOLDERS[sys.id] === f.id) ? WAR.holderStart : WAR.otherStart;
        row[f.id] = clamp(v, 0, 100);
      });
    });
    return t;
  }

  function _systemId() {
    if (!window.SF || !SF.Game || !SF.SYSTEM_BY_ID) return null;
    var id = SF.Game.systemId;
    return (typeof id === 'string' && SF.SYSTEM_BY_ID[id]) ? id : null;
  }

  var Factions = {

    /* ---- standing ---- */
    standing: function (factionId) {
      var s = P().factionState || {};
      return clamp(s[factionId] || 0, -100, 100);
    },

    shift: function (factionId, delta) {
      var s = P().factionState;
      if (!s) return;
      var before = this.stance(factionId);
      s[factionId] = clamp((s[factionId] || 0) + delta, -100, 100);
      var after = this.stance(factionId);
      // planets-facilities: stance crossings make the news
      if (before !== after && window.SF && SF.News) {
        var fname = BY_ID[factionId].name;
        if (after === 'hostile') SF.News.push('\u26A0 ' + fname +
          ' has declared you HOSTILE. Their patrols will engage on sight.');
        else if (after === 'friendly') SF.News.push('\u2728 ' + fname +
          ' now counts you as a FRIEND. Favorable prices at their holdings.');
        else SF.News.push('\uD83D\uDCF0 ' + fname + ' standing shifted: you are ' + after.toUpperCase() + ' to them now.');
      }
    },

    // hostile < -25, neutral -25..49, friendly >= 50
    stance: function (factionId) {
      var v = this.standing(factionId);
      if (v >= 50) return 'friendly';
      if (v < -25) return 'hostile';
      return 'neutral';
    },

    /* ---- karma (-100..+100) ---- */
    karma: function () { return clamp(P().karmaState || 0, -100, 100); },

    shiftKarma: function (delta) {
      P().karmaState = clamp((P().karmaState || 0) + delta, -100, 100);
    },

    karmaLabel: function (v) {
      if (v === undefined) v = this.karma();
      if (v <= -50) return 'Infamous';
      if (v < -15) return 'Shady';
      if (v <= 15) return 'Neutral';
      if (v < 50) return 'Upstanding';
      return 'Heroic';
    },

    /* ---- acts ---- */
    // spec:
    //   kill pirate         -> Compact +2, karma +1
    //   first shot at a faction patrol -> that faction -5, karma -2
    //   destroy a faction patrol ship   -> that faction -10, karma -4
    // faction-warfare: destroying a faction patrol ship ALSO erodes that
    // faction's control of the current system by 2 (hooked here so the
    // existing enemies.js call site needs no edit).
    act: function (act, factionId) {
      if (act === 'killPirate') {
        this.shift('compact', 2);
        this.shiftKarma(1);
        this._toast('Solar Compact +2 standing');
        // planets-facilities: kills make the wire
        if (window.SF && SF.News && Math.random() < 0.25)
          SF.News.push('\uD83D\uDCF0 Compact wire: freelance captain destroyed a pirate in ' +
            (SF.Game && SF.Game.systemId ? SF.SYSTEM_BY_ID[SF.Game.systemId].name : 'the sector') + '.');
      } else if (act === 'attackPatrol') {
        this.shift(factionId, -5);
        this.shiftKarma(-2);
        this._toast(BY_ID[factionId].name + ' -5 standing');
      } else if (act === 'destroyPatrol') {
        this.shift(factionId, -10);
        this.shiftKarma(-4);
        this._toast(BY_ID[factionId].name + ' -10 standing!');
        try { this.onKill(factionId); } catch (e) { /* territory unavailable */ }
      }
    },

    _toast: function (msg) {
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg);
    },

    /* ---- price multiplier at a legit station ----
     * evil pays +15%, good gets -5%, allied (standing>=50) gets -10%.
     * stationFaction: the faction whose station the player is docked at.
     */
    priceMul: function (stationFaction) {
      var mul = 1;
      var k = this.karma();
      if (k <= -15) mul *= 1.15;
      else if (k >= 15) mul *= 0.95;
      if (stationFaction && this.standing(stationFaction) >= 50) mul *= 0.90;
      return Math.round(mul * 100) / 100;
    },

    /* ---- black-market pricing (planets-facilities) ----
     * Notorious captains get fence discounts; squeaky-clean ones pay a
     * "you look like a cop" surcharge.
     */
    blackMarketMul: function () {
      var k = this.karma();
      if (k <= -50) return 0.75;
      if (k <= -30) return 0.85;
      if (k <= -15) return 0.95;
      if (k >= 15) return 1.10;
      return 1.0;
    },

    /* ---- patrol hostility threshold ----
     * Neutral patrols engage only if provoked; hostile-stance patrols
     * hunt the player; friendly patrols stand down. Called per-enemy
     * in enemies.js update loop.
     */
    patrolStance: function (factionId) { return this.stance(factionId); },

    /* ============================================================
     * TERRITORY WARFARE
     * ============================================================ */

    // tuning + initial holders, exposed for balance passes and tests
    WAR: WAR,
    HOLDERS: HOLDERS,

    /* Control value 0-100 of one faction in one system. */
    control: function (systemId, factionId) {
      var t = _territory();
      if (!t || !t[systemId] || !BY_ID[factionId]) return 0;
      return t[systemId][factionId];
    },

    /* Majority holder of a system. Ties resolve deterministically by
     * SF.FACTION_LIST order (compact, drifters, ember). */
    majority: function (systemId) {
      var t = _territory();
      if (!t || !t[systemId]) return null;
      var row = t[systemId], best = null, bestV = -Infinity;
      FACTIONS.forEach(function (f) {
        var v = row[f.id];
        if (v > bestV) { bestV = v; best = f.id; }
      });
      return best;
    },

    /* Core primitive: shift one faction's control in one system by delta.
     * Clamps 0-100. On majority change, pushes a news-wire flip and toasts.
     * Returns {before, after, flipped, value} or null when unavailable. */
    adjust: function (systemId, factionId, delta) {
      var t = _territory();
      if (!t || !t[systemId] || !BY_ID[factionId] || !isFinite(delta)) return null;
      var before = this.majority(systemId);
      t[systemId][factionId] = clamp(t[systemId][factionId] + delta, 0, 100);
      var after = this.majority(systemId);
      if (before !== after) this._flipNews(systemId, before, after);
      return { before: before, after: after,
               flipped: before !== after, value: t[systemId][factionId] };
    },

    _flipNews: function (systemId, before, after) {
      var sysName = (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[systemId])
        ? SF.SYSTEM_BY_ID[systemId].name : systemId;
      var pk = this.perks(systemId);
      var msg = '\uD83C\uDFB4 CONTROL SHIFT \u2014 ' + BY_ID[after].name +
        ' has seized ' + sysName +
        (before ? ' from ' + BY_ID[before].name : '') +
        '. System perk: ' + pk.text + '.';
      if (window.SF && SF.News) SF.News.push(msg);
      this._toast('\uD83C\uDFB4 ' + sysName + ' now under ' + BY_ID[after].name + ' control');
    },

    /* ---- territory events (runtime hooks) ----
     * onKill: faction-ship kill in the current system -> that faction -2.
     *   Also fired automatically from act('destroyPatrol'), the call site
     *   enemies.js already uses on every faction-ship kill.
     * onQuestTurnIn: quest turn-in for a faction -> +3 in the current system.
     *   WIRING NEEDED (quests.js is outside this phase's scope): in
     *   quests.js turnIn(), after the standing shift, add:
     *     if (window.SF && SF.Factions && SF.Factions.onQuestTurnIn)
     *       SF.Factions.onQuestTurnIn(q.faction);
     * onTradeSold: selling goods/ore/components -> the system's local faction
     *   (SF.CONFIG.trading.systemFaction) gains +0.5 control per 1000cr.
     *   WIRING NEEDED (station.js is outside this phase's scope): after
     *   credits are granted on a sale, add:
     *     if (window.SF && SF.Factions && SF.Factions.onTradeSold)
     *       SF.Factions.onTradeSold(creditsGained);
     */
    onKill: function (factionId) {
      var sys = _systemId();
      if (!sys) return null;
      return this.adjust(sys, factionId, WAR.killDelta);
    },

    onQuestTurnIn: function (factionId) {
      var sys = _systemId();
      if (!sys) return null;
      return this.adjust(sys, factionId, WAR.questDelta);
    },

    onTradeSold: function (credits) {
      var sys = _systemId();
      if (!sys || !isFinite(credits) || credits <= 0) return null;
      var map = (window.SF && SF.CONFIG.trading && SF.CONFIG.trading.systemFaction) || {};
      var local = map[sys] || this.majority(sys);
      if (!BY_ID[local]) return null;
      return this.adjust(sys, local, WAR.tradePer1k * credits / 1000);
    },

    /* ---- system perks ----
     * The majority holder grants one system-wide perk:
     *   Solar Compact: -10% buy prices   (perkBuyMul 0.9)
     *   Free Drifters: +10% sell prices  (perkSellMul 1.1)
     *   Ember Pact:    +15% salvage      (perkSalvageMul 1.15)
     * WIRING NEEDED (follow-up phases): station.js buy/sell pricing should
     * multiply by perkBuyMul/perkSellMul of the docked system; enemies.js
     * salvage/drop credit rolls should multiply by perkSalvageMul.
     */
    perks: function (systemId) {
      var holder = this.majority(systemId);
      var out = { holder: holder, buyMul: 1, sellMul: 1, salvageMul: 1,
                  text: 'Contested space \u2014 no faction perk' };
      if (holder === 'compact') {
        out.buyMul = 0.9;
        out.text = 'Solar Compact majority: -10% buy prices';
      } else if (holder === 'drifters') {
        out.sellMul = 1.1;
        out.text = 'Free Drifters majority: +10% sell prices';
      } else if (holder === 'ember') {
        out.salvageMul = 1.15;
        out.text = 'Ember Pact majority: +15% salvage';
      }
      return out;
    },

    perkBuyMul: function (systemId) { return this.perks(systemId).buyMul; },
    perkSellMul: function (systemId) { return this.perks(systemId).sellMul; },
    perkSalvageMul: function (systemId) { return this.perks(systemId).salvageMul; },

    /* ---- territory readout ----
     * Self-contained HTML section rendered by THIS module (starmap.js and
     * hud.js are outside this phase's file scope, so the readout lives here
     * instead of in the star map). A follow-up phase can inject it into the
     * HUD faction panel (`hud-factions`) or the star map via
     * SF.Factions.renderTerritoryPanel(el).
     */
    territoryPanelHTML: function () {
      var self = this;
      var h = '<div class="sf-terr" style="font-family:monospace;color:#cfe3ff;">' +
        '<div style="font-weight:bold;font-size:15px;margin-bottom:8px;letter-spacing:1px;">' +
        '\u2694 FACTION TERRITORY</div>';
      if (!window.SF || !SF.SYSTEMS) return h + '</div>';
      SF.SYSTEMS.forEach(function (sys) {
        var pk = self.perks(sys.id);
        h += '<div style="margin-bottom:10px;border:1px solid #2a3a55;border-radius:6px;' +
          'padding:8px;background:rgba(10,18,32,0.6);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="font-weight:bold;color:' + sys.color + ';">' + sys.name + '</span>';
        if (pk.holder) {
          h += '<span style="font-size:11px;background:' + BY_ID[pk.holder].color + '22;' +
            'border:1px solid ' + BY_ID[pk.holder].color + ';border-radius:4px;' +
            'padding:2px 6px;color:' + BY_ID[pk.holder].color + ';">\u25C8 ' +
            BY_ID[pk.holder].short + ' HOLDS</span>';
        }
        h += '</div>';
        FACTIONS.forEach(function (f) {
          var v = self.control(sys.id, f.id);
          h += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:11px;">' +
            '<span style="width:34px;color:' + f.color + ';">' + f.short + '</span>' +
            '<div style="flex:1;height:10px;background:#101826;border-radius:5px;overflow:hidden;">' +
            '<div style="height:100%;width:' + v.toFixed(0) + '%;background:' + f.color + ';"></div>' +
            '</div><span style="width:30px;text-align:right;">' + v.toFixed(0) + '</span></div>';
        });
        h += '<div style="font-size:11px;color:#9fb6d8;margin-top:4px;">' + pk.text + '</div></div>';
      });
      return h + '</div>';
    },

    /* Inject the territory readout into a DOM element (id string or node).
     * Returns true when rendered. */
    renderTerritoryPanel: function (el) {
      var node = typeof el === 'string' ? document.getElementById(el) : el;
      if (!node) return false;
      node.innerHTML = this.territoryPanelHTML();
      return true;
    }

  };

  SF.Factions = Factions;
})();
/* ============================================================
 * diplomacy-defections phase: SF.Defections — one-shot defection
 * missions. When the pilot's standing with a faction drops below
 * -50, a rival faction's envoy offers a one-time defection mission:
 * deliver a data cache to the rival's HQ system, or sabotage a
 * patrol of the hated faction. Completing it resets the hated
 * faction's standing to -20 and grants the rival +40.
 *
 * Save-neutral: all state lives additively on the existing
 * P.factions blob (P.factions.defections {offered, done}) with
 * defensive reads — old saves simply have no key. NO
 * SF.SAVE_VERSION bump; ship.js serialize()/deserialize() already
 * round-trips the whole factions object.
 *
 * Integration is additive-only (no edits to quests.js / enemies.js /
 * news.js / planets.js / station.js):
 *   - missions ride questState.active as normal-looking quests
 *     (name/brief set, so the base quest board + log render safely)
 *     with a `df` marker; sabotage progress is counted by a
 *     __df wrap on SF.Enemies.kill; defection quests auto-complete
 *     (sabotage on the final kill, delivery on dock in the target
 *     system) — the base turnIn never handles them.
 *   - offers + delivery completion hook into dock/land via __df
 *     wraps on SF.Station.dock and SF.Planets.land (the dialogue must
 *     open AFTER the dock flow: setState('DOCKED') hides every overlay
 *     except overlay-store).
 *   - dropping a mission appends a DROP row to the quest log via a
 *     __df wrap on SF.Quests.openLog.
 *   - announcements use SF.News.push only when present.
 * All wraps install lazily (factions.js loads before quests.js and
 * planets.js, so load order can't be trusted); every public entry
 * point calls installWraps() first, plus a window load listener.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var OFFER_THRESHOLD = -50;  // standing with A below this -> rival envoy offers
  var RESET_STANDING = -20;    // A's standing is reset to exactly this on completion
  var RIVAL_BONUS = 40;        // B gains exactly this on completion
  var SABOTAGE_KILLS = 3;      // patrol ships to destroy for the sabotage variant
  var TRUST_LINE = 10;         // standing(B) >= this -> B trusts you with the data cache
  var DEFECTION_REWARD = 500;  // credits on completion

  /* ordered from/to pairs: 3 factions x 2 rivals = 6 pairs */
  var PAIRS = [
    ['compact', 'drifters'], ['compact', 'ember'],
    ['drifters', 'compact'], ['drifters', 'ember'],
    ['ember', 'compact'], ['ember', 'drifters']
  ];

  function pairKey(from, to) { return from + '>' + to; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }

  /* Additive blob on the factions object: P.factions.defections.
   * { offered: {pairKey: true}, done: {pairKey: true} }
   * Defensive reads rebuild missing/corrupt keys in place. */
  function dfBlob() {
    var fs = null;
    try { fs = (SF.Player && SF.Player.factionState) || null; } catch (e) { return null; }
    if (!fs || typeof fs !== 'object') return null;
    var d = fs.defections;
    if (!d || typeof d !== 'object') d = fs.defections = {};
    if (!d.offered || typeof d.offered !== 'object') d.offered = {};
    if (!d.done || typeof d.done !== 'object') d.done = {};
    return d;
  }

  function hqSystemOf(factionId) {
    if (window.SF && SF.FACTION_HQ) {
      for (var i = 0; i < SF.FACTION_HQ.length; i++)
        if (SF.FACTION_HQ[i].factionId === factionId) return SF.FACTION_HQ[i].systemId;
    }
    var map = (window.SF && SF.CONFIG && SF.CONFIG.trading &&
               SF.CONFIG.trading.systemFaction) || {};
    for (var s in map) if (map[s] === factionId) return s;
    return null;
  }

  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }

  var Defections = {

    /* ---- state queries ---- */
    offered: function (from, to) {
      var d = dfBlob(); return !!(d && d.offered[pairKey(from, to)]);
    },

    done: function (from, to) {
      var d = dfBlob(); return !!(d && d.done[pairKey(from, to)]);
    },

    activeQuest: function () {
      var act = [];
      try { act = (SF.Player && SF.Player.questState && SF.Player.questState.active) || []; }
      catch (e) { return null; }
      for (var i = 0; i < act.length; i++)
        if (act[i] && act[i].df) return act[i];
      return null;
    },

    /* Pairs whose envoy should speak now: standing(from) < -50, never
     * offered, and no defection mission already running. */
    eligiblePairs: function () {
      var out = [];
      if (!window.SF || !SF.Factions) return out;
      if (this.activeQuest()) return out;
      var d = dfBlob();
      if (!d) return out;
      var self = this;
      PAIRS.forEach(function (p) {
        var from = p[0], to = p[1];
        if (d.offered[pairKey(from, to)]) return;
        try {
          if (SF.Factions.standing(from) < OFFER_THRESHOLD)
            out.push({ from: from, to: to });
        } catch (e) { /* factions unavailable */ }
      });
      return out;
    },

    /* Which mission the envoy proposes: trusted pilots carry the data
     * cache, unknowns must prove themselves with sabotage. */
    missionKind: function (to) {
      try {
        return (SF.Factions.standing(to) >= TRUST_LINE) ? 'deliver' : 'sabotage';
      } catch (e) { return 'sabotage'; }
    },

    /* ---- dock hook (called by the rollOffers / land wraps) ----
     * 1. deliver completion: docked in the rival's HQ system with an
     *    active data-cache run -> the drop happens, mission completes.
     * 2. otherwise scan for envoy offers. */
    onDock: function () {
      installWraps();
      var q = this.activeQuest();
      if (q && q.df && q.df.kind === 'deliver' && q.state === 'active') {
        var here = (window.SF && SF.Game) ? SF.Game.systemId : null;
        if (here && here === q.df.dest) {
          this.complete(q);
          return; // one event per dock; offers wait for the next dock
        }
      }
      this.maybeOffer();
    },

    /* ---- the envoy approaches ----
     * Presenting the offer IS the one offer per pair: every shown pair is
     * marked offered up front, whether the pilot accepts, declines, or
     * walks away. One dialogue lists every eligible envoy. */
    maybeOffer: function () {
      installWraps();
      var pairs = this.eligiblePairs();
      if (!pairs.length) return false;
      if (!window.SF || !SF.Dialogue) return false;
      var d = dfBlob();
      var self = this;
      pairs.forEach(function (p) { d.offered[pairKey(p.from, p.to)] = true; });
      save();
      var names = pairs.map(function (p) { return SF.FACTION_BY_ID[p.to].name; });
      var text = '\u201CCaptain. A word, away from listening ears.\u201D\n\n' +
        'A figure in ' + (pairs.length > 1 ? 'rival colors' : 'a rival\u2019s colors') +
        ' slides into the booth across from you. Word travels fast when a pilot' +
        ' falls out of favor \u2014 and right now, ';
      text += pairs.map(function (p) {
        return 'the ' + SF.FACTION_BY_ID[p.to].name + ' would pay to turn your grudge against the ' +
          SF.FACTION_BY_ID[p.from].name;
      }).join('; ') + '.\n\nOne job. One chance. Walk away and the offer dies here.';
      var choices = pairs.map(function (p) {
        return {
          label: '\uD83E\uDD1D Hear out the ' + SF.FACTION_BY_ID[p.to].name + ' envoy',
          run: function () { self.offerDialogue(p.from, p.to); }
        };
      });
      SF.Dialogue.open({ title: '\uD83D\uDEA8 A rival envoy approaches', text: text, choices: choices });
      toast('\uD83D\uDEA8 A rival envoy wants a word\u2026');
      news('\uD83D\uDCE1 Rival envoys (' + names.join(', ') +
        ') were seen courting a disgraced captain. The wire smells a defection.');
      save();
      return true;
    },

    /* The pitch: what the job is, what it pays, what changes. */
    offerDialogue: function (from, to) {
      installWraps();
      if (!window.SF || !SF.Dialogue) return false;
      var self = this;
      var kind = this.missionKind(to);
      var fromName = SF.FACTION_BY_ID[from].name;
      var toName = SF.FACTION_BY_ID[to].name;
      var job, brief;
      if (kind === 'deliver') {
        var dest = hqSystemOf(to);
        job = 'Carry a sealed data cache to the ' + toName + ' \u2014 dock anywhere in the ' +
          sysName(dest) + ' system and the drop is done. No questions, no receipts.';
        brief = 'Deliver the sealed data cache: dock anywhere in the ' + sysName(dest) +
          ' system. The drop happens automatically on landing.';
      } else {
        job = 'Prove you\u2019ve turned: destroy ' + SABOTAGE_KILLS + ' ' + fromName +
          ' patrol ships, anywhere. The wire will carry the word \u2014 no need to report back.';
        brief = 'Sabotage: destroy ' + SABOTAGE_KILLS + ' ' + fromName +
          ' patrol ships, anywhere. Completes on the final kill.';
      }
      var text = '\u201CThe ' + fromName + ' wrote you off, captain. We haven\u2019t.\u201D\n\n' +
        '\u201CHere\u2019s the job: ' + job + '\u201D\n\n' +
        'Pay: ' + DEFECTION_REWARD + 'cr on completion.\n' +
        'Terms: ' + fromName + ' standing reset to ' + RESET_STANDING + ', ' +
        toName + ' +' + RIVAL_BONUS + ' standing.\n' +
        'Decline or walk away, and nothing changes \u2014 but the offer never comes again.';
      SF.Dialogue.open({
        title: '\uD83E\uDD1D ' + toName + ' envoy',
        text: text,
        choices: [
          { label: '\u2714 Take the job', run: function () { self.accept(from, to, kind); } },
          { label: '\u2716 Decline \u2014 standings stay as they are', run: function () { self.decline(from, to); } }
        ]
      });
      return true;
    },

    /* ---- accept: the mission goes on the quest log as a normal quest
     * (name/brief set so the base board + log render it safely), marked
     * with `df`. Sabotage counts via the Enemies.kill wrap; delivery
     * completes on dock in the target system. */
    accept: function (from, to, kind) {
      installWraps();
      var d = dfBlob();
      if (!d) return false;
      if (this.activeQuest()) { toast('You already have a defection mission running.'); return false; }
      kind = kind || this.missionKind(to);
      var hqDest = (kind === 'deliver') ? hqSystemOf(to) : null;
      if (kind === 'deliver' && !hqDest) kind = 'sabotage'; // no HQ system known
      d.offered[pairKey(from, to)] = true;
      var fromName = SF.FACTION_BY_ID[from].name;
      var toName = SF.FACTION_BY_ID[to].name;
      var dest = (kind === 'deliver') ? hqDest : null;
      var brief = (kind === 'deliver')
        ? 'Defection run for the ' + toName + ': deliver the sealed data cache \u2014 dock ' +
          'anywhere in the ' + sysName(dest) + ' system. The drop happens on landing.'
        : 'Defection run for the ' + toName + ': destroy ' + SABOTAGE_KILLS + ' ' + fromName +
          ' patrol ships, anywhere (' + RESET_STANDING + ' ' + fromName + ' / +' + RIVAL_BONUS +
          ' ' + toName + ' on the final kill).';
      var here = (window.SF && SF.Game) ? (SF.Game.systemId + ':' + SF.Game.dockedAt) : '?:?';
      var q = {
        id: 'df-' + from + '-' + to + '-' + Date.now().toString(36),
        type: 'kill', n: (kind === 'sabotage') ? SABOTAGE_KILLS : 1, diff: 2,
        reward: DEFECTION_REWARD, faction: to, weapon: null,
        station: (kind === 'deliver' && dest) ? (dest + ':' + sysName(dest)) : here,
        progress: 0, state: 'active',
        name: (kind === 'deliver' ? 'Defection: data cache for ' : 'Defection: sabotage ') + toName,
        brief: brief,
        df: { kind: kind, pair: pairKey(from, to), from: from, to: to, dest: dest }
      };
      var st = SF.Player.questState;
      st.active = st.active || [];
      st.active.push(q);
      toast('\uD83E\uDD1D Defection mission accepted: ' + q.name);
      news('\uD83D\uDCE1 A disgraced captain took a meeting with the ' + toName +
        '. The ' + fromName + ' will hear of this.');
      save();
      if (window.SF && SF.Dialogue) {
        SF.Dialogue.open({
          title: '\uD83E\uDD1D The deal is struck',
          text: '\u201CThen it\u2019s done. ' + brief + '\u201D\n\nThe envoy is gone before your drink arrives.',
          choices: []
        });
      }
      return true;
    },

    decline: function (from, to) {
      var d = dfBlob();
      if (d) d.offered[pairKey(from, to)] = true;
      toast('You walk away. Nothing changes \u2014 the offer is gone for good.');
      save();
      if (window.SF && SF.Dialogue) SF.Dialogue.close();
      return true;
    },

    /* ---- drop: walk away from an active mission. Standings untouched. ---- */
    drop: function (questId) {
      var q = null;
      var act = (SF.Player && SF.Player.questState && SF.Player.questState.active) || [];
      for (var i = 0; i < act.length; i++)
        if (act[i] && act[i].id === questId && act[i].df) { q = act[i]; break; }
      if (!q) return false;
      var d = dfBlob();
      if (d) d.offered[q.df.pair] = true; // the one offer is spent
      if (window.SF && SF.Quests) SF.Quests.abandon(q.id);
      toast('\u274C Mission dropped. The envoy melts back into the crowd. Standings unchanged.');
      news('\uD83D\uDCE1 A defection plot fizzled \u2014 the captain walked away from the ' +
        SF.FACTION_BY_ID[q.df.to].name + ' envoy.');
      save();
      return true;
    },

    /* ---- complete: A resets to exactly -20, B gains exactly +40 ---- */
    complete: function (q) {
      if (!q || !q.df) return false;
      var df = q.df;
      var fromName = SF.FACTION_BY_ID[df.from].name;
      var toName = SF.FACTION_BY_ID[df.to].name;
      // reset A to exactly -20 (shift keeps stance-crossing news honest)
      var cur = SF.Factions.standing(df.from);
      if (cur !== RESET_STANDING) SF.Factions.shift(df.from, RESET_STANDING - cur);
      // B gains exactly +40 (shift clamps at +-100)
      SF.Factions.shift(df.to, RIVAL_BONUS);
      SF.Player.credits += (q.reward || 0);
      var act = SF.Player.questState.active || [];
      var i = act.indexOf(q);
      if (i >= 0) act.splice(i, 1);
      SF.Player.questState.done = (SF.Player.questState.done || 0) + 1;
      var d = dfBlob();
      if (d) { d.offered[df.pair] = true; d.done[df.pair] = true; }
      toast('\uD83C\uDFC6 DEFECTION COMPLETE: ' + fromName + ' \u2192 ' + RESET_STANDING +
        ', ' + toName + ' +' + RIVAL_BONUS + ' standing. +' + (q.reward || 0) + 'cr.');
      if (window.SF && SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      news('\uD83C\uDFC6 DEFECTION \u2014 a captain burned the ' + fromName + ' and joined the ' +
        toName + '. Standing reset to ' + RESET_STANDING + '; ' + toName + ' +' + RIVAL_BONUS + '.');
      save();
      return true;
    },

    /* tuning + pairs exposed for tests and balance passes */
    TUNE: { OFFER_THRESHOLD: OFFER_THRESHOLD, RESET_STANDING: RESET_STANDING,
            RIVAL_BONUS: RIVAL_BONUS, SABOTAGE_KILLS: SABOTAGE_KILLS,
            TRUST_LINE: TRUST_LINE, DEFECTION_REWARD: DEFECTION_REWARD },
    PAIRS: PAIRS
  };

  SF.Defections = Defections;

  /* ============================================================
   * Lazy wrap installation. factions.js loads before quests.js and
   * planets.js, so none of the wrap targets exist yet at this section's
   * load time. installWraps() is idempotent and is called from every
   * public entry point plus window load.
   * ============================================================ */
  var _installed = false;

  function installWraps() {
    if (_installed) return;
    if (!window.SF || !SF.Quests || !SF.Enemies || !SF.Dialogue || !SF.Station) return;
    _installed = true;

    /* ---- dock hook: runs AFTER the dock flow so the envoy dialogue
     * survives setState('DOCKED') (which hides every overlay but the
     * store). ---- */
    (function () {
      var S = SF.Station;
      var orig = S && S.dock;
      if (!orig || orig.__df) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.Defections) SF.Defections.onDock(); } catch (e) {}
        return r;
      };
      w.__df = true;
      S.dock = w;
    })();

    /* ---- planet-landing hook: SF.Planets.land bypasses rollOffers ---- */
    (function () {
      var P = SF.Planets;
      var orig = P && P.land;
      if (!orig || orig.__df) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.Defections) SF.Defections.onDock(); } catch (e) {}
        return r;
      };
      w.__df = true;
      P.land = w;
    })();

    /* ---- sabotage progress: count faction-A patrol kills ----
     * Chains after the __cq (companion-quests) and __cg
     * (companion-gear) kill wraps; same additive pattern. */
    (function () {
      var orig = SF.Enemies && SF.Enemies.kill;
      if (!orig || orig.__df) return;
      var w = function (e) {
        var r = orig.apply(this, arguments);
        try {
          var q = (window.SF && SF.Defections) ? SF.Defections.activeQuest() : null;
          if (q && q.df && q.df.kind === 'sabotage' && q.state === 'active' &&
              e && e.faction === q.df.from) {
            q.progress++;
            if (q.progress >= q.n) {
              SF.Defections.complete(q);
            } else {
              toast('\u2694 Sabotage: ' + q.progress + '/' + q.n + ' ' +
                SF.FACTION_BY_ID[q.df.from].name + ' patrols destroyed');
            }
            save();
          }
        } catch (err) { /* never break kills */ }
        return r;
      };
      w.__df = true;
      SF.Enemies.kill = w;
    })();

    /* ---- quest-log DROP row for the active defection mission ---- */
    (function () {
      var orig = SF.Quests && SF.Quests.openLog;
      if (!orig || orig.__df) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try {
          var q = (window.SF && SF.Defections) ? SF.Defections.activeQuest() : null;
          var body = document.getElementById('quests-body');
          if (q && body) {
            var h = document.createElement('div');
            h.className = 'store-head';
            h.textContent = 'DEFECTION';
            body.appendChild(h);
            var row = document.createElement('div');
            row.className = 'store-row';
            row.innerHTML =
              '<div class="store-info"><div><div class="store-name">' + q.name + '</div>' +
              '<div class="store-desc">' + q.brief +
              '<br>Walking away spends your one offer \u2014 standings stay as they are.</div></div></div>' +
              '<button class="btn store-btn">DROP</button>';
            row.querySelector('button').addEventListener('click', function () {
              SF.Defections.drop(q.id);
              SF.Quests.openLog();
            });
            body.appendChild(row);
          }
        } catch (e) { /* never break the quest log */ }
        return r;
      };
      w.__df = true;
      SF.Quests.openLog = w;
    })();
  }

  /* public entry points install lazily, so tests and the dock flow work
   * even if the load listener hasn't fired yet */
  ['onDock', 'maybeOffer', 'offerDialogue', 'accept', 'decline', 'drop', 'complete',
   'eligiblePairs', 'activeQuest'].forEach(function (k) {
    var fn = Defections[k];
    Defections[k] = function () { installWraps(); return fn.apply(Defections, arguments); };
  });

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();
/* ============================================================
 * quest-board-hq phase: SF.FactionContracts — repeatable
 * faction-flavored contracts posted at the 3 faction HQ stations
 * (Aegis Citadel / compact, Karavan Prime / drifters,
 * Ashen Throne / ember — read from SF.FACTION_HQ in js/data.js).
 *
 * Each HQ board posts 3 standing-gated contracts, one per kind:
 *   KILL    (STANDARD tier, standing 0+)  — destroy N pirates
 *             (factionless hostiles; the pirate packs harassing the
 *             posting faction's shipping — the faction's rivals)
 *   SUPPLY  (TRUSTED tier, standing 25+) — deliver N salvage parts
 *   PATROL  (ALLIED tier, standing 50+)  — visit every nav point in
 *             the HQ's system (system station + planets), then report
 *             back. Aegis Citadel's circuit is exactly 3 points.
 *
 * Rewards scale with standing at accept time:
 *   credits = round(creditBase * (1 + standing/100) / 5) * 5
 *   standing payout = tier bonus (3/5/7) — small, base-quest spirit.
 *
 * Integration is additive-only (no edits to quests.js / station.js /
 * planets.js / news.js / save.js):
 *   - contracts ride the existing quest OBJECT shape
 *     {id,type,n,reward,faction,station,progress,state,name,brief}
 *     with an `hqcb` marker, stored in an additive blob on the
 *     existing questState blob: questState.hqcb = { offers, active }.
 *     Defensive reads rebuild missing keys; ship.js serialize() /
 *     deserialize() round-trip the whole questState, so this is
 *     SAVE-NEUTRAL — no SF.SAVE_VERSION bump.
 *   - the contracts tab is injected into the HQ store by a lazy
 *     __hqcb wrap on SF.HQ.render (planets.js untouched).
 *   - kill progress rides a lazy __hqcb wrap on SF.Quests.onKill
 *     (chains with campaign.js's wraps; pirates = !e.faction, same
 *     rule as the base quest board).
 *   - patrol visits ride lazy __hqcb wraps on SF.Station.dock and
 *     SF.Planets.land (chain with the __df defection wraps).
 *   - announcements use SF.News.push only when present.
 * All wraps install lazily (factions.js loads before quests.js and
 * planets.js); every public entry point calls installWraps() first,
 * plus a window load listener.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var TIERS = [
    { tier: 0, name: 'STANDARD', gate: 0,  standing: 3, creditBase: 300 },
    { tier: 1, name: 'TRUSTED',  gate: 25, standing: 5, creditBase: 450 },
    { tier: 2, name: 'ALLIED',   gate: 50, standing: 7, creditBase: 650 }
  ];
  var KIND_TIER = { kill: 0, supply: 1, patrol: 2 }; // which tier each kind posts at
  var KILL_N = 5;    // pirates to destroy
  var SUPPLY_N = 8;  // salvage parts to deliver

  var KIND_LABEL = { kill: '\u2620 KILL CONTRACT', supply: '\uD83D\uDCE6 SUPPLY RUN',
                     patrol: '\uD83D\uDEE1 PATROL SWEEP' };

  /* faction-flavored contract copy, per posting faction */
  var FLAVOR = {
    compact: {
      killName: 'Lane Sweep: Pirate Scourge',
      killBrief: 'Pirate packs are bleeding Compact shipping. Hunt them down — the lanes stay open, and the Compact remembers its friends.',
      supplyName: 'Citadel Requisition Run',
      supplyBrief: 'The Citadel quartermaster is short on salvage parts for the patrol refits. No questions asked — just parts.',
      patrolName: 'Citadel Patrol Circuit',
      patrolBrief: 'Fly the circuit and show the flag. The Compact wants eyes on its space.'
    },
    drifters: {
      killName: 'Convoy Guard: Pirate Cull',
      killBrief: 'Drifter convoys are getting bled dry by pirate packs. Cull them — the Karavan pays its debts.',
      supplyName: 'Karavan Supply Haul',
      supplyBrief: 'The Karavan is always hungry for parts. Haul salvage to Karavan Prime — fair pay, no paperwork.',
      patrolName: 'Drift Patrol Circuit',
      patrolBrief: 'Sweep the drift and check in everywhere. Independent space stays independent because somebody watches it.'
    },
    ember: {
      killName: 'Cinder Hunt: Pirate Burn',
      killBrief: 'Parasites pick at Pact shipping. Burn them out — the Throne rewards strength, not excuses.',
      supplyName: 'Throne Forge Tithe',
      supplyBrief: 'The forge-masters demand salvage parts for the war machine. Deliver to the Ashen Throne.',
      patrolName: 'Ember Vigil Circuit',
      patrolBrief: 'Keep the vigil over Pact space. The Throne sees all — make sure it sees you.'
    }
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function factionName(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].name : fid;
  }
  function factionShort(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].short : fid;
  }

  function hqById(hqId) {
    if (window.SF && SF.HQ_BY_ID && SF.HQ_BY_ID[hqId]) return SF.HQ_BY_ID[hqId];
    if (window.SF && SF.FACTION_HQ) {
      for (var i = 0; i < SF.FACTION_HQ.length; i++)
        if (SF.FACTION_HQ[i].id === hqId) return SF.FACTION_HQ[i];
    }
    return null;
  }

  /* Nav points for a patrol sweep: the HQ system's station (if any) +
   * its planets. Aegis Citadel's circuit is exactly 3 points. */
  function navPoints(hq) {
    var pts = [];
    if (!hq || !window.SF) return pts;
    var sys = SF.SYSTEM_BY_ID ? SF.SYSTEM_BY_ID[hq.systemId] : null;
    if (sys && sys.station && sys.station.name) pts.push(sys.station.name);
    if (SF.PLANETS) SF.PLANETS.forEach(function (p) {
      if (p.systemId === hq.systemId && pts.indexOf(p.name) < 0) pts.push(p.name);
    });
    return pts;
  }

  /* Additive blob on the existing questState:
   *   questState.hqcb = { offers: { hqId: [contract...] }, active: [contract...] }
   * Defensive reads rebuild missing/corrupt keys in place. */
  function cbBlob() {
    var st = null;
    try { st = (SF.Player && SF.Player.questState) || null; } catch (e) { return null; }
    if (!st || typeof st !== 'object') return null;
    var b = st.hqcb;
    if (!b || typeof b !== 'object') b = st.hqcb = {};
    if (!b.offers || typeof b.offers !== 'object') b.offers = {};
    if (!b.active || !Array.isArray(b.active)) b.active = [];
    return b;
  }

  function creditFor(tierDef, standing) {
    return Math.round(tierDef.creditBase * (1 + standing / 100) / 5) * 5;
  }

  function makeContract(hq, kind) {
    var tier = TIERS[KIND_TIER[kind]];
    var fl = FLAVOR[hq.factionId] || FLAVOR.compact;
    var pts = (kind === 'patrol') ? navPoints(hq) : [];
    var n = kind === 'kill' ? KILL_N : kind === 'supply' ? SUPPLY_N : pts.length;
    var targetLine = kind === 'kill' ? 'Destroy ' + n + ' pirates anywhere.'
      : kind === 'supply' ? 'Deliver ' + n + ' salvage parts to ' + hq.name + '.'
      : 'Dock at each of these ' + n + ' nav points, then report back to ' + hq.name +
        ': ' + pts.join(' · ') + '.';
    return {
      id: 'hqcb-' + hq.id + '-' + kind + '-' + Date.now().toString(36) + rint(100, 999),
      type: kind, n: n, reward: 0, // reward computed at accept (standing-scaled)
      faction: hq.factionId,
      station: hq.systemId + ':' + hq.name,
      progress: 0, state: 'offer',
      name: KIND_LABEL[kind] + ' — ' + fl[kind + 'Name'],
      brief: fl[kind + 'Brief'] + ' ' + targetLine,
      hqcb: { hqId: hq.id, kind: kind, tier: tier.tier, gate: tier.gate,
              standing: tier.standing, creditBase: tier.creditBase,
              points: pts, visited: [] }
    };
  }

  function activeFor(b, hqId) {
    return b.active.filter(function (q) {
      return q && q.hqcb && q.hqcb.hqId === hqId && q.state === 'active';
    });
  }

  function partsCount() {
    var inv = {};
    try { inv = (SF.Player && SF.Player.partInventory) || {}; } catch (e) {}
    return Object.keys(inv).reduce(function (a, k) { return a + (inv[k] || 0); }, 0);
  }

  function takeParts(n) {
    var inv = {};
    try { inv = (SF.Player && SF.Player.partInventory) || {}; } catch (e) { return; }
    var need = n;
    Object.keys(inv).forEach(function (k) {
      if (need <= 0) return;
      var take = Math.min(inv[k] || 0, need);
      inv[k] -= take; need -= take;
      if (inv[k] <= 0) delete inv[k];
    });
  }

  function atHQ(q) {
    return !!(window.SF && SF.Game &&
      SF.Game.systemId + ':' + SF.Game.dockedAt === q.station);
  }

  var Contracts = {

    TIERS: TIERS,
    TUNE: { KILL_N: KILL_N, SUPPLY_N: SUPPLY_N, KIND_TIER: KIND_TIER },

    /* Nav points for an HQ's patrol circuit (array of dockable names). */
    navPoints: function (hqId) {
      var hq = typeof hqId === 'string' ? hqById(hqId) : hqId;
      return navPoints(hq);
    },

    /* The board: 3 offers (kill/supply/patrol), regenerated when empty
     * and the pilot holds no active contract from this HQ. */
    board: function (hqId) {
      installWraps();
      var b = cbBlob();
      var hq = hqById(hqId);
      if (!b || !hq) return [];
      var list = b.offers[hqId];
      if ((!list || !list.length) && activeFor(b, hqId).length === 0) {
        list = b.offers[hqId] = ['kill', 'supply', 'patrol'].map(function (k) {
          return makeContract(hq, k);
        });
        save();
      }
      return list || [];
    },

    /* Active HQ contracts (any HQ). */
    active: function () {
      installWraps();
      var b = cbBlob();
      if (!b) return [];
      return b.active.filter(function (q) { return q && q.state === 'active'; });
    },

    /* ---- accept an offer ----
     * Gate: standing(faction) >= tier gate, and no other active
     * contract from this HQ. Reward is computed from standing now. */
    accept: function (offerId) {
      installWraps();
      var b = cbBlob();
      if (!b) return false;
      var found = null, hqId = null;
      Object.keys(b.offers).forEach(function (id) {
        (b.offers[id] || []).forEach(function (o, i) {
          if (o && o.id === offerId) { found = o; hqId = id; }
        });
      });
      if (!found) return false;
      var standing = 0;
      try { standing = (window.SF && SF.Factions) ? SF.Factions.standing(found.faction) : 0; }
      catch (e) {}
      if (standing < found.hqcb.gate) {
        toast('Requires ' + factionShort(found.faction) + ' standing ' + found.hqcb.gate +
          ' (you: ' + standing + ').');
        return false;
      }
      if (activeFor(b, hqId).length > 0) {
        toast('Finish your active ' + hqById(hqId).name + ' contract first.');
        return false;
      }
      var i = b.offers[hqId].indexOf(found);
      if (i >= 0) b.offers[hqId].splice(i, 1);
      found.state = 'active';
      found.progress = 0;
      found.reward = creditFor(TIERS[found.hqcb.tier], standing);
      b.active.push(found);
      toast('\uD83D\uDCCB Contract accepted: ' + found.name + ' (' + found.reward + 'cr on completion)');
      if (window.SF && SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      news('\uD83D\uDCCB ' + factionName(found.faction) + ' contract board: a captain took "' +
        found.name + '" (' + TIERS[found.hqcb.tier].name + ' tier, ' + found.reward + 'cr).');
      save();
      if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      return true;
    },

    /* A contract is ready to turn in when its objective is complete.
     * Supply additionally needs the parts in the hold. */
    ready: function (q) {
      if (!q || q.state !== 'active') return false;
      if (q.type === 'supply') return partsCount() >= q.n;
      return q.progress >= q.n;
    },

    /* ---- turn in: must be docked at the posting HQ ----
     * Pays credits + tier standing, bumps the quest done counter,
     * announces on the wire. */
    turnIn: function (contractId) {
      installWraps();
      var b = cbBlob();
      if (!b) return false;
      var q = null;
      for (var i = 0; i < b.active.length; i++)
        if (b.active[i] && b.active[i].id === contractId) { q = b.active[i]; break; }
      if (!q || q.state !== 'active') return false;
      if (!atHQ(q)) { toast('Return to ' + q.station.split(':')[1] + ' to collect.'); return false; }
      if (q.type === 'supply') {
        if (partsCount() < q.n) { toast('You need ' + q.n + ' salvage parts in the hold.'); return false; }
        takeParts(q.n);
      } else if (q.progress < q.n) {
        return false;
      }
      var ai = b.active.indexOf(q);
      if (ai >= 0) b.active.splice(ai, 1);
      try { SF.Player.credits += q.reward; } catch (e) {}
      try {
        var st = SF.Player.questState;
        st.done = (st.done || 0) + 1;
      } catch (e) {}
      var sGain = q.hqcb.standing;
      if (window.SF && SF.Factions) SF.Factions.shift(q.faction, sGain);
      toast('\u2714 Contract paid: +' + q.reward + 'cr, ' + factionName(q.faction) +
        ' +' + sGain + ' standing');
      if (window.SF && SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      news('\u2714 ' + factionName(q.faction) + ' contract complete: "' + q.name +
        '" paid ' + q.reward + 'cr (+' + sGain + ' standing).');
      save();
      if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      return true;
    },

    /* ---- kill hook: pirates (factionless hostiles) advance kill contracts.
     * Called from the __hqcb wrap on SF.Quests.onKill. ---- */
    onKill: function (e) {
      installWraps();
      if (!e || e.faction) return;
      var b = cbBlob();
      if (!b) return;
      var hit = false;
      b.active.forEach(function (q) {
        if (q && q.hqcb && q.hqcb.kind === 'kill' && q.state === 'active' && q.progress < q.n) {
          q.progress++;
          hit = true;
          if (q.progress >= q.n)
            toast('\u2620 Kill contract complete — collect at ' + q.station.split(':')[1]);
        }
      });
      if (hit) save();
    },

    /* ---- dock hook: visiting a patrol nav point advances patrol contracts.
     * Called from the __hqcb wraps on SF.Station.dock / SF.Planets.land. ---- */
    onDockAt: function (name) {
      installWraps();
      if (!name) return;
      var b = cbBlob();
      if (!b) return;
      var hit = false;
      b.active.forEach(function (q) {
        if (q && q.hqcb && q.hqcb.kind === 'patrol' && q.state === 'active') {
          var pts = q.hqcb.points || [];
          if (pts.indexOf(name) >= 0 && q.hqcb.visited.indexOf(name) < 0) {
            q.hqcb.visited.push(name);
            q.progress = q.hqcb.visited.length;
            hit = true;
            toast('\uD83D\uDEE1 Patrol: ' + name + ' visited (' + q.progress + '/' + q.n + ')');
          }
        }
      });
      if (hit) save();
    },

    /* ---- contracts tab, injected into the HQ store by the __hqcb wrap
     * on SF.HQ.render. Rendered by THIS module (planets.js untouched). ---- */
    renderTab: function (body, hq) {
      installWraps();
      if (!body || !hq) return false;
      var self = this;
      var b = cbBlob();
      var fid = hq.factionId;
      var f = (window.SF && SF.FACTION_BY_ID) ? SF.FACTION_BY_ID[fid] : null;
      var standing = 0;
      try { standing = (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0; } catch (e) {}

      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '\uD83D\uDCCB CONTRACTS — ' + (f ? f.short : fid);
      body.appendChild(h);

      var sub = document.createElement('div');
      sub.className = 'dim';
      sub.style.marginBottom = '6px';
      sub.textContent = 'Posted by ' + factionName(fid) + '. Your standing: ' + standing +
        '. One active contract per station — finish it to see fresh postings.';
      body.appendChild(sub);

      function row(name, desc, btnLabel, btnFn, disabled, disReason) {
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div><div class="store-name">' + name + '</div>' +
          '<div class="store-desc">' + desc +
          (disabled && disReason ? '<br><span class="dim">\uD83D\uDD12 ' + disReason + '</span>' : '') +
          '</div></div></div>' +
          '<button class="btn store-btn"' + (disabled ? ' disabled' : '') + '>' + btnLabel + '</button>';
        if (!disabled) div.querySelector('button').addEventListener('click', btnFn);
        body.appendChild(div);
      }

      var offers = b ? (this.board(hq.id) || []) : [];
      var hasActive = b ? activeFor(b, hq.id).length > 0 : false;
      offers.forEach(function (o) {
        var tier = TIERS[o.hqcb.tier];
        var gated = standing < o.hqcb.gate;
        var desc = o.brief +
          '<br>Tier: <b>' + tier.name + '</b> (standing ' + o.hqcb.gate + '+)' +
          ' · Reward: <b>' + creditFor(tier, standing) + 'cr</b>' +
          ' · +' + o.hqcb.standing + ' ' + factionShort(fid) + ' standing';
        row(o.name, desc, 'ACCEPT',
          function () { self.accept(o.id); },
          gated || hasActive,
          gated ? 'Requires ' + factionShort(fid) + ' standing ' + o.hqcb.gate + ' (you: ' + standing + ')'
                : 'Finish your active contract first');
      });

      (b ? activeFor(b, hq.id) : []).forEach(function (q) {
        var tier = TIERS[q.hqcb.tier];
        var rdy = self.ready(q);
        var prog = q.type === 'supply'
          ? 'Parts in hold: <b>' + partsCount() + '/' + q.n + '</b>'
          : 'Progress: <b>' + q.progress + '/' + q.n + '</b>';
        row('\u25B6 ' + q.name,
          q.brief + '<br>' + prog +
          ' · Payout: <b>' + q.reward + 'cr</b> · +' + q.hqcb.standing + ' standing' +
          '<br>Turn in at: <b>' + hq.name + '</b>' +
          (rdy ? '' : '<br><span class="dim">Not complete yet.</span>'),
          'TURN IN',
          function () { self.turnIn(q.id); },
          !rdy, rdy ? '' : 'Objective incomplete');
      });
      return true;
    }
  };

  SF.FactionContracts = Contracts;

  /* ============================================================
   * Lazy wrap installation (factions.js loads before quests.js and
   * planets.js). Idempotent via the __hqcb flag; chains under the
   * __df defection wraps and campaign.js's onKill wraps.
   * ============================================================ */
  var _installed = false;

  function installWraps() {
    if (_installed) return;
    if (!window.SF || !SF.HQ || !SF.Quests || !SF.Station || !SF.Planets) return;
    _installed = true;

    /* contracts tab inside the HQ store */
    (function () {
      var orig = SF.HQ.render;
      if (!orig || orig.__hqcb) return;
      var w = function (body, hq) {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.FactionContracts) SF.FactionContracts.renderTab(body, hq); }
        catch (e) { /* never break the HQ store */ }
        return r;
      };
      w.__hqcb = true;
      SF.HQ.render = w;
    })();

    /* kill progress for HQ kill contracts (pirates = factionless) */
    (function () {
      var orig = SF.Quests.onKill;
      if (!orig || orig.__hqcb) return;
      var w = function (e) {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.FactionContracts) SF.FactionContracts.onKill(e); } catch (err) {}
        return r;
      };
      w.__hqcb = true;
      SF.Quests.onKill = w;
    })();

    /* patrol visits: station docks */
    (function () {
      var S = SF.Station;
      var orig = S && S.dock;
      if (!orig || orig.__hqcb) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try {
          if (window.SF && SF.FactionContracts && SF.Game)
            SF.FactionContracts.onDockAt(SF.Game.dockedAt);
        } catch (e) {}
        return r;
      };
      w.__hqcb = true;
      S.dock = w;
    })();

    /* patrol visits: planet landings */
    (function () {
      var P = SF.Planets;
      var orig = P && P.land;
      if (!orig || orig.__hqcb) return;
      var w = function (pl) {
        var r = orig.apply(this, arguments);
        try {
          if (window.SF && SF.FactionContracts)
            SF.FactionContracts.onDockAt(pl && pl.name);
        } catch (e) {}
        return r;
      };
      w.__hqcb = true;
      P.land = w;
    })();
  }

  /* public entry points install lazily, so tests and the dock flow work
   * even if the load listener hasn't fired yet */
  ['board', 'active', 'accept', 'turnIn', 'ready', 'onKill', 'onDockAt',
   'renderTab', 'navPoints'].forEach(function (k) {
    var fn = Contracts[k];
    Contracts[k] = function () { installWraps(); return fn.apply(Contracts, arguments); };
  });

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();
/* ============================================================
 * faction-treaties phase: SF.Treaties — pacts, charters, war.
 *
 * Per-faction treaties negotiated from the faction HQ contracts
 * tab (SF.FactionContracts.renderTab, same file — a __trt wrap
 * appends a TREATIES section with a NEGOTIATE button), resolved
 * through the shared SF.Dialogue overlay (npcs.js).
 *
 *   Non-Aggression Pact: patrols of that faction stand down
 *     (patrolStance -> 'friendly'). Costs 1500cr, standing >= 10.
 *   Trade Charter: 10% station discount at their stations
 *     (priceMul x 0.90). Costs 4000cr, requires an active Pact.
 *   War Declaration: their patrols hunt you (patrolStance ->
 *     'hostile'), +50% bounty payouts vs them (bounty renegade
 *     affiliation), breaks Pact + Charter, and locks re-treaty
 *     for 10 days (UTC calendar days, same convention as
 *     daily-contracts).
 *   Decay: 3 faction-ship kills while a Pact holds break it
 *     (and the Charter with it). The engine does not distinguish
 *     provoked from unprovoked kills, so every faction-ship kill
 *     counts — noted as a design simplification.
 *
 * Save-neutral: treaty state lives ADDITIVELY in
 *   SF.Player.storyState.treaties = { <factionId>: {
 *     pact, charter, war, warSince (UTC 'YYYY-MM-DD'), kills } }
 * with defensive reads; ship.js serialize() already deep-copies
 * the whole story blob. NO SF.SAVE_VERSION bump (stays v11).
 *
 * Integration is additive-only (no edits outside this file):
 *   - lazy __trt wraps on SF.Factions.patrolStance (pact/war
 *     hostility), SF.Factions.priceMul (charter discount),
 *     SF.Factions.onKill (pact decay, chained with territory),
 *     SF.Bounty.turnIn (war bounty bonus x1.5), and
 *     SF.FactionContracts.renderTab (treaty section in the HQ tab).
 * All wraps install lazily (factions.js loads before npcs.js,
 * gameplay.js, planets.js, so load order can't be trusted);
 * every public entry point calls installWraps() first, plus a
 * window load listener.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var PACT_COST = 1500;
  var PACT_STANDING = 10;
  var CHARTER_COST = 4000;
  var CHARTER_DISCOUNT = 0.90;
  var WAR_LOCK_DAYS = 10;
  var PACT_BREAK_KILLS = 3;
  var WAR_BOUNTY_MUL = 1.5;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function fname(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].name : fid;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function daysBetween(a, b) { // UTC 'YYYY-MM-DD' -> whole days
    if (typeof a !== 'string' || typeof b !== 'string') return NaN;
    var t = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
    return isFinite(t) ? Math.round(t / 86400000) : NaN;
  }

  /* Additive blob on storyState: storyState.treaties.
   * Defensive reads rebuild missing/corrupt keys in place. */
  function stBlob() {
    var s = null;
    try { s = (window.SF && SF.Player) ? SF.Player.storyState : null; } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    return s;
  }
  function trBlob() {
    var s = stBlob();
    if (!s) return null;
    var t = s.treaties;
    if (!t || typeof t !== 'object') t = s.treaties = {};
    return t;
  }
  /* Normalized treaty record for one faction. _raw is the live object. */
  function get(fid) {
    var t = trBlob();
    if (!t) return { pact: false, charter: false, war: false, warSince: null, kills: 0, _raw: null };
    var r = t[fid];
    if (!r || typeof r !== 'object') r = t[fid] = {};
    return {
      pact: !!r.pact, charter: !!r.charter, war: !!r.war,
      warSince: (typeof r.warSince === 'string') ? r.warSince : null,
      kills: (isFinite(r.kills) && r.kills > 0) ? Math.floor(r.kills) : 0,
      _raw: r
    };
  }
  function write(fid, patch) {
    var t = trBlob();
    if (!t) return false;
    var r = t[fid];
    if (!r || typeof r !== 'object') r = t[fid] = {};
    for (var k in patch) r[k] = patch[k];
    return true;
  }

  var Treaties = {

    /* ---- state queries ---- */
    get: function (fid) { installWraps(); var g = get(fid); delete g._raw; return g; },
    hasPact: function (fid) { return get(fid).pact; },
    hasCharter: function (fid) { return get(fid).charter; },
    atWar: function (fid) { return get(fid).war; },

    /* Whole days since the war declaration (NaN-safe -> 0). */
    warDays: function (fid) {
      var g = get(fid);
      if (!g.war || !g.warSince) return 0;
      var d = daysBetween(g.warSince, todayStr());
      return isFinite(d) ? Math.max(0, d) : 0;
    },
    warDaysLeft: function (fid) {
      return Math.max(0, WAR_LOCK_DAYS - this.warDays(fid));
    },
    /* Re-treaty is locked while the 10-day war cooldown runs. */
    canTreaty: function (fid) {
      var g = get(fid);
      return !g.war || this.warDaysLeft(fid) <= 0;
    },

    treatyStatusText: function (fid) {
      var g = get(fid);
      if (g.war) {
        var left = this.warDaysLeft(fid);
        return 'AT WAR' + (left > 0 ? ' — they will treat again in ' + left + 'd' : ' — the embers have cooled; peace is possible');
      }
      var parts = [];
      if (g.pact) parts.push('Non-Aggression Pact ACTIVE');
      if (g.charter) parts.push('Trade Charter ACTIVE');
      return parts.length ? parts.join(' · ') : 'no treaty';
    },

    /* ---- negotiation actions ---- */
    signPact: function (fid) {
      installWraps();
      var g = get(fid);
      if (g.pact) return { ok: false, why: 'already' };
      if (!this.canTreaty(fid)) return { ok: false, why: 'warlock', days: this.warDaysLeft(fid) };
      var standing = 0, credits = 0;
      try { standing = SF.Factions.standing(fid); } catch (e) {}
      try { credits = SF.Player.credits || 0; } catch (e) {}
      if (standing < PACT_STANDING) return { ok: false, why: 'standing', need: PACT_STANDING, have: standing };
      if (credits < PACT_COST) return { ok: false, why: 'credits', need: PACT_COST, have: credits };
      SF.Player.credits = credits - PACT_COST;
      // A pact ends any war with this faction.
      write(fid, { pact: true, war: false, warSince: g.warSince, kills: 0 });
      toast('\uD83D\uDCDC Non-Aggression Pact signed with ' + fname(fid));
      news('\uD83D\uDCDC ' + fname(fid) + ' has signed a Non-Aggression Pact with a freelance captain. Their patrols will stand down.');
      if (window.SF && SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx('treaty_signed'); } catch (e) {} }
      save();
      return { ok: true };
    },

    buyCharter: function (fid) {
      installWraps();
      var g = get(fid);
      if (g.charter) return { ok: false, why: 'already' };
      if (!g.pact) return { ok: false, why: 'nopact' };
      var credits = 0;
      try { credits = SF.Player.credits || 0; } catch (e) {}
      if (credits < CHARTER_COST) return { ok: false, why: 'credits', need: CHARTER_COST, have: credits };
      SF.Player.credits = credits - CHARTER_COST;
      write(fid, { charter: true });
      toast('\uD83D\uDCDC Trade Charter purchased — 10% off at ' + fname(fid) + ' stations');
      news('\uD83D\uDCDC A Trade Charter grants a freelance captain 10% station discounts with ' + fname(fid) + '.');
      if (window.SF && SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx('treaty_signed'); } catch (e) {} }
      save();
      return { ok: true };
    },

    declareWar: function (fid) {
      installWraps();
      var g = get(fid);
      if (g.war) return { ok: false, why: 'already' };
      write(fid, { war: true, warSince: todayStr(), pact: false, charter: false, kills: 0 });
      try { if (window.SF && SF.Factions) SF.Factions.shift(fid, -15); } catch (e) {}
      toast('\u2694 WAR declared on ' + fname(fid) + '!');
      news('\u2694 WAR — a freelance captain has declared war on ' + fname(fid) + '. Their patrols will engage on sight. Bounty payouts against them rise 50%.');
      if (window.SF && SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx('treaty_broken'); } catch (e) {} }
      save();
      return { ok: true };
    },

    /* ---- pact decay ----
     * Called (via the onKill wrap) on every faction-ship kill. After
     * PACT_BREAK_KILLS kills the pact — and the charter with it — breaks. */
    onKill: function (fid) {
      installWraps();
      var g = get(fid);
      if (!g.pact || g.war) return;
      var n = g.kills + 1;
      if (n >= PACT_BREAK_KILLS) {
        write(fid, { pact: false, charter: false, kills: 0 });
        toast('\uD83D\uDCDC ' + fname(fid) + ' tears up your Pact — too many of their ships destroyed!');
        news('\uD83D\uDCDC ' + fname(fid) + ' has voided its Non-Aggression Pact. "Three of our ships, captain. We are done talking."');
        if (window.SF && SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx('treaty_broken'); } catch (e) {} }
      } else {
        write(fid, { kills: n });
        toast('\u26A0\uFE0F ' + fname(fid) + ' notes the kill (' + n + '/' + PACT_BREAK_KILLS + ') — your Pact is fraying.');
      }
      save();
    },

    /* ---- effect multipliers (used by the wraps) ---- */
    charterDiscountMul: function () { return CHARTER_DISCOUNT; },
    warBountyMul: function () { return WAR_BOUNTY_MUL; },

    /* ---- negotiation dialogue (shared SF.Dialogue overlay) ---- */
    negotiate: function (fid, confirmWar) {
      installWraps();
      if (!window.SF || !SF.Dialogue) return false;
      var self = this;
      var g = get(fid);
      var standing = 0, credits = 0;
      try { standing = SF.Factions.standing(fid); } catch (e) {}
      try { credits = SF.Player.credits || 0; } catch (e) {}
      var title = '\uD83D\uDCDC Treaty talks — ' + fname(fid);
      var text, choices = [];

      function failText(r) {
        if (r.why === 'standing') return 'They laugh you out of the room: standing ' + r.have + ' (need ' + r.need + '+).';
        if (r.why === 'credits') return 'You cannot cover the fee: ' + r.have + 'cr on hand (need ' + r.need + 'cr).';
        if (r.why === 'warlock') return 'Their envoy will not see you for ' + r.days + ' more days. War is fresh.';
        if (r.why === 'nopact') return 'They only charter captains who hold a Pact.';
        return 'They decline.';
      }

      if (confirmWar) {
        text = 'The envoy goes pale. "War? Against ' + fname(fid) + '? Say it plainly, captain — there is no unsaying it."';
        choices.push({ label: '\u2694 CONFIRM — declare war', run: function () {
          var r = self.declareWar(fid);
          if (r.ok) { toast('\u2694 War it is.'); self.negotiate(fid); }
          else { self.negotiate(fid); }
        }});
        choices.push({ label: 'Reconsider', run: function () { self.negotiate(fid); } });
      } else if (g.war) {
        var left = this.warDaysLeft(fid);
        text = 'Status: AT WAR.' + (left > 0
          ? ' Their guns are still warm — no envoy will treat for ' + left + ' more days.'
          : ' The embers have cooled. They would hear a peace offer now.');
        if (left <= 0) choices.push({ label: 'Sue for peace — sign Pact (' + PACT_COST + 'cr, standing 10+)', run: function () {
          var r = self.signPact(fid);
          if (!r.ok) toast(failText(r)); else toast('\uD83D\uDCDC Peace signed.');
          self.negotiate(fid);
        }});
      } else {
        text = 'Status: ' + this.treatyStatusText(fid) +
          ' · Your standing: ' + standing + ' · Credits: ' + credits + 'cr.\n' +
          'Pact (' + PACT_COST + 'cr, standing ' + PACT_STANDING + '+): their patrols stand down.\n' +
          'Charter (' + CHARTER_COST + 'cr, needs Pact): 10% off at their stations.';
        if (!g.pact) choices.push({ label: 'Sign Non-Aggression Pact (' + PACT_COST + 'cr)', run: function () {
          var r = self.signPact(fid);
          if (!r.ok) toast(failText(r));
          self.negotiate(fid);
        }});
        if (g.pact && !g.charter) choices.push({ label: 'Buy Trade Charter (' + CHARTER_COST + 'cr)', run: function () {
          var r = self.buyCharter(fid);
          if (!r.ok) toast(failText(r));
          self.negotiate(fid);
        }});
        if (g.pact || g.charter) choices.push({ label: '\u2694 Declare WAR on ' + fname(fid), run: function () {
          self.negotiate(fid, true);
        }});
      }

      SF.Dialogue.open({ title: title, text: text, choices: choices });
      return true;
    },

    /* ---- HQ contracts tab section (injected by the renderTab wrap) ---- */
    renderTabSection: function (body, fid) {
      installWraps();
      if (!body || !fid) return false;
      var self = this;
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '\uD83D\uDCDC TREATIES';
      body.appendChild(h);
      var row = document.createElement('div');
      row.className = 'store-row';
      var status = this.treatyStatusText(fid);
      var desc = 'Status: <b>' + status + '</b>';
      if (this.hasPact(fid) && !this.hasCharter(fid))
        desc += '<br>Charter available: 10% station discount (' + CHARTER_COST + 'cr).';
      if (this.atWar(fid) && this.warDaysLeft(fid) <= 0)
        desc += '<br>Their envoy would hear a peace offer now.';
      row.innerHTML = '<div class="store-info"><div><div class="store-name">Treaty talks — ' + fname(fid) +
        '</div><div class="store-desc">' + desc + '</div></div></div>' +
        '<button class="btn store-btn">NEGOTIATE</button>';
      row.querySelector('button').addEventListener('click', function () { self.negotiate(fid); });
      body.appendChild(row);
      return true;
    },

    /* ---- test-only hooks ---- */
    testReset: function () {
      var t = trBlob();
      if (t) for (var k in t) delete t[k];
    },
    testSetWar: function (fid, daysAgo) {
      var d = new Date(Date.now() - (daysAgo || 0) * 86400000);
      write(fid, { war: true, warSince: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()), pact: false, charter: false, kills: 0 });
    }
  };

  /* ---- lazy wraps (factions.js loads before npcs.js / gameplay.js /
   * planets.js, so every target may be undefined on first pass) ---- */
  function installWraps() {
    if (!window.SF) return;

    /* patrol hostility: pact -> friendly, war -> hostile */
    (function () {
      var F = SF.Factions;
      if (!F || !F.patrolStance || F.patrolStance.__trt) return;
      var orig = F.patrolStance;
      F.patrolStance = function (fid) {
        try {
          if (Treaties.atWar(fid)) return 'hostile';
          if (Treaties.hasPact(fid)) return 'friendly';
        } catch (e) {}
        return orig.call(this, fid);
      };
      F.patrolStance.__trt = true;
    })();

    /* trade charter discount at their stations */
    (function () {
      var F = SF.Factions;
      if (!F || !F.priceMul || F.priceMul.__trt) return;
      var orig = F.priceMul;
      F.priceMul = function (stationFaction) {
        var m = orig.call(this, stationFaction);
        try {
          if (stationFaction && Treaties.hasCharter(stationFaction))
            m = Math.round(m * CHARTER_DISCOUNT * 100) / 100;
        } catch (e) {}
        return m;
      };
      F.priceMul.__trt = true;
    })();

    /* pact decay: chain onto the territory onKill (fired by
     * act('destroyPatrol') on every faction-ship kill) */
    (function () {
      var F = SF.Factions;
      if (!F || !F.onKill || F.onKill.__trt) return;
      var orig = F.onKill;
      F.onKill = function (fid) {
        var r = orig.call(this, fid);
        try { Treaties.onKill(fid); } catch (e) {}
        return r;
      };
      F.onKill.__trt = true;
    })();

    /* war bounty bonus: +50% when the target's renegade faction is at war */
    (function () {
      var B = SF.Bounty;
      if (!B || !B.turnIn || B.turnIn.__trt) return;
      var orig = B.turnIn;
      B.turnIn = function () {
        var b = null, boosted = false, origReward = 0;
        try { b = this.active(); } catch (e) { b = null; }
        try {
          if (b && b.state === 'ready' && b.renegade && Treaties.atWar(b.renegade)) {
            origReward = b.reward; b.reward = Math.round(b.reward * WAR_BOUNTY_MUL);
            boosted = true;
          }
        } catch (e) {}
        var r = orig.call(this);
        try { if (boosted && b) b.reward = origReward; } catch (e) {}
        return r;
      };
      B.turnIn.__trt = true;
    })();

    /* treaty section in the faction HQ contracts tab */
    (function () {
      var FC = SF.FactionContracts;
      if (!FC || !FC.renderTab || FC.renderTab.__trt) return;
      var orig = FC.renderTab;
      FC.renderTab = function (body, hq) {
        var r = orig.call(this, body, hq);
        try { if (r && body && hq) Treaties.renderTabSection(body, hq.factionId); } catch (e) {}
        return r;
      };
      FC.renderTab.__trt = true;
    })();
  }

  /* public entry points install lazily, so tests and the dock flow work
   * even if the load listener hasn't fired yet */
  ['get', 'hasPact', 'hasCharter', 'atWar', 'warDays', 'warDaysLeft',
   'canTreaty', 'treatyStatusText', 'signPact', 'buyCharter', 'declareWar',
   'onKill', 'negotiate', 'renderTabSection'].forEach(function (k) {
    var fn = Treaties[k];
    Treaties[k] = function () { installWraps(); return fn.apply(Treaties, arguments); };
  });

  SF.Treaties = Treaties;

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();


/* ============================================================
 * treaty-ceasefire phase: SF.Ceasefire — negotiated end to war.
 *
 * Builds on faction-treaties (SF.Treaties), which left war with no
 * negotiated end other than waiting out the 10-day re-treaty lock.
 * While at war, the treaty negotiation dialogue gains a CEASEFIRE
 * TALKS option:
 *
 *   - Reparations scale with war duration and the pilot's kill count
 *     vs that faction during the war:
 *       2000cr base + 250cr per war day + 150cr per war kill.
 *   - Paying buys a +15 standing goodwill shift; talks succeed iff
 *     standing >= -10 AFTER the payment. Payment is taken up front:
 *     if standing is still below -10 the talks fail, the credits are
 *     gone, and the war continues. (Can't pay at all -> talks never
 *     open; war continues.)
 *   - Success ends the war IMMEDIATELY, breaking the 10-day
 *     re-treaty lock, and puts the faction on a 'demilitarized'
 *     stance for 5 days (UTC-day convention, same as the war lock):
 *     the treaty faction's patrol SHIPS don't spawn in their
 *     systems — but pirates and rogues keep spawning at their normal
 *     danger-weighted rate (they never signed your treaty) — and any
 *     of their ships still in flight read as 'neutral' through the
 *     patrolStance API — they neither hunt the pilot nor stand down
 *     to assist. Afterwards everything reverts to the normal
 *     standing-driven rules, which the >= -10 gate guarantees is
 *     neutral.
 *   - War and demilitarization are mutually exclusive: re-declaring
 *     war during the window voids it.
 *
 * Save-neutral: all state is additive on the existing
 *   SF.Player.storyState.treaties = { <factionId>: { ...,
 *     warKills, demilSince (UTC 'YYYY-MM-DD') } }
 * with defensive reads; the faction-treaties normalizer ignores
 * unknown fields and ship.js serialize() deep-copies storyState.
 * NO SF.SAVE_VERSION bump (stays v11).
 *
 * Integration is additive-only (no edits outside this file):
 *   - lazy __cf wrap on SF.Dialogue.open appends the CEASEFIRE TALKS
 *     choice to the treaty-talks dialogue while at war
 *   - lazy __cf wraps on SF.Factions.patrolStance (demil -> neutral),
 *     SF.Treaties.treatyStatusText (demil readout in the HQ tab),
 *     SF.Enemies.spawnPatrol (strip the treaty faction's ships from
 *     patrol batches in demilitarized faction systems; pirates/rogues
 *     still spawn at their normal rate), SF.Factions.onKill (count war kills for the
 *     reparations formula), SF.Treaties.declareWar (re-declaring
 *     voids the demil window + resets the kill count)
 * All wraps install lazily (factions.js loads before npcs.js, so
 * SF.Dialogue may not exist yet); every public entry point calls
 * installWraps() first, plus a window load listener.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var REPARATION_BASE = 2000;     // flat diplomatic fee
  var REPARATION_PER_WAR_DAY = 250;
  var REPARATION_PER_KILL = 150;  // per faction-ship kill during this war
  var STANDING_BOOST = 15;        // goodwill shift when reparations are paid
  var STANDING_REQ = -10;         // talks succeed iff standing >= this after payment
  var DEMIL_DAYS = 5;             // demilitarized window (UTC days)

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function fname(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].name : fid;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function daysBetween(a, b) { // UTC 'YYYY-MM-DD' -> whole days
    if (typeof a !== 'string' || typeof b !== 'string') return NaN;
    var t = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
    return isFinite(t) ? Math.round(t / 86400000) : NaN;
  }
  function round5(n) { return Math.round(n / 5) * 5; }

  /* Additive fields on the existing storyState.treaties record:
   *   warKills   — faction-ship kills while at war with this faction
   *   demilSince — UTC 'YYYY-MM-DD' the demilitarized window started
   * Defensive reads rebuild missing/corrupt keys in place. */
  function rawRec(fid) {
    var s = null;
    try { s = (window.SF && SF.Player) ? SF.Player.storyState : null; } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    var t = s.treaties;
    if (!t || typeof t !== 'object') t = s.treaties = {};
    var r = t[fid];
    if (!r || typeof r !== 'object') r = t[fid] = {};
    return r;
  }

  function atWar(fid) {
    try { return !!(window.SF && SF.Treaties && SF.Treaties.atWar(fid)); }
    catch (e) { return false; }
  }

  /* Wrap-chain hygiene: marker flags (__trt, __cf, ...) live on the
   * outermost wrapper of a chain. When this phase chains outside
   * another phase's wrap, inherit its flags so that phase's install
   * guard keeps seeing "installed" instead of re-wrapping on every
   * call (which would stack duplicate layers). */
  function inheritMarks(w, orig) {
    if (!orig) return;
    for (var k in orig) {
      if (k.length > 2 && k.slice(0, 2) === '__' && orig[k] === true) w[k] = true;
    }
  }

  var Ceasefire = {

    TUNE: { REPARATION_BASE: REPARATION_BASE,
            REPARATION_PER_WAR_DAY: REPARATION_PER_WAR_DAY,
            REPARATION_PER_KILL: REPARATION_PER_KILL,
            STANDING_BOOST: STANDING_BOOST, STANDING_REQ: STANDING_REQ,
            DEMIL_DAYS: DEMIL_DAYS },

    /* ---- reparations quote ----
     * {base, days, kills, perDay, perKill, total} */
    reparationsFor: function (fid) {
      installWraps();
      var days = 0;
      try {
        if (window.SF && SF.Treaties) days = SF.Treaties.warDays(fid) || 0;
      } catch (e) {}
      var kills = this.warKillsOf(fid);
      var total = round5(REPARATION_BASE + REPARATION_PER_WAR_DAY * days +
                         REPARATION_PER_KILL * kills);
      return { base: REPARATION_BASE, days: days, kills: kills,
               perDay: REPARATION_PER_WAR_DAY, perKill: REPARATION_PER_KILL,
               total: total };
    },

    /* Faction-ship kills during the current war (0 when not at war). */
    warKillsOf: function (fid) {
      installWraps();
      if (!atWar(fid)) return 0;
      var r = rawRec(fid);
      if (!r) return 0;
      var k = r.warKills;
      return (isFinite(k) && k > 0) ? Math.floor(k) : 0;
    },

    /* ---- demilitarized window ---- */
    demilDaysLeft: function (fid) {
      installWraps();
      var r = rawRec(fid);
      if (!r || typeof r.demilSince !== 'string') return 0;
      var d = daysBetween(r.demilSince, todayStr());
      if (!isFinite(d)) return 0;
      return Math.max(0, DEMIL_DAYS - Math.max(0, d));
    },

    demilActive: function (fid) {
      installWraps();
      return this.demilDaysLeft(fid) > 0;
    },

    demilStatusText: function (fid) {
      installWraps();
      var left = this.demilDaysLeft(fid);
      return left > 0 ? ('DEMILITARIZED \u2014 ' + left + 'd of quiet') : 'no ceasefire';
    },

    /* ---- the talks ----
     * Payment is taken up front; then standing (after the +15
     * goodwill shift) must be >= -10. Returns {ok, ...}. */
    talks: function (fid) {
      installWraps();
      if (!atWar(fid)) return { ok: false, why: 'nowar' };
      var rep = this.reparationsFor(fid);
      var credits = 0, standing = 0;
      try { credits = SF.Player.credits || 0; } catch (e) {}
      try { standing = (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0; } catch (e) {}
      if (credits < rep.total)
        return { ok: false, why: 'credits', need: rep.total, have: credits };
      // The envoy takes the reparations either way.
      try { SF.Player.credits = credits - rep.total; } catch (e) {}
      try { if (window.SF && SF.Factions) SF.Factions.shift(fid, STANDING_BOOST); } catch (e) {}
      try { standing = (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0; } catch (e) {}
      save();
      if (standing < STANDING_REQ) {
        toast('\uD83D\uDD4A\uFE0F ' + fname(fid) + ' takes your ' + rep.total +
          'cr \u2014 and walks out. Standing ' + standing + ' (need ' + STANDING_REQ +
          '+). The war continues.');
        news('\uD83D\uDD4A\uFE0F Ceasefire talks with ' + fname(fid) + ' collapsed. ' +
          '"Your credits are noted, captain. Your record is not forgiven." The war continues.');
        save();
        return { ok: false, why: 'standing', need: STANDING_REQ, have: standing,
                 paid: rep.total };
      }
      // Success: the war ends NOW, breaking the 10-day re-treaty lock.
      var r = rawRec(fid);
      if (r) { r.war = false; r.warSince = null; r.warKills = 0; r.demilSince = todayStr(); }
      toast('\uD83D\uDD4A\uFE0F CEASEFIRE with ' + fname(fid) + '! The war is over. ' +
        'Their patrols stand down for ' + DEMIL_DAYS + ' days.');
      news('\uD83D\uDD4A\uFE0F CEASEFIRE \u2014 ' + fname(fid) + ' has signed a ceasefire ' +
        'with a freelance captain (' + rep.total + 'cr reparations). A ' + DEMIL_DAYS +
        '-day demilitarized window begins.');
      if (window.SF && SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx('treaty_signed'); } catch (e) {} }
      save();
      return { ok: true, paid: rep.total, standing: standing, demilDays: DEMIL_DAYS };
    },

    /* ---- the envoy's table (dialogue) ----
     * Opened from the CEASEFIRE TALKS choice that the SF.Dialogue.open
     * wrap appends to the treaty negotiation dialogue while at war. */
    negotiateTalks: function (fid) {
      installWraps();
      if (!window.SF || !SF.Dialogue) return false;
      if (!atWar(fid)) { toast('You are not at war with ' + fname(fid) + '.'); return false; }
      var self = this;
      var rep = this.reparationsFor(fid);
      var standing = 0, credits = 0;
      try { standing = (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0; } catch (e) {}
      try { credits = SF.Player.credits || 0; } catch (e) {}
      var proj = clamp(standing + STANDING_BOOST, -100, 100);
      var text =
        'Their envoy slides a casualty ledger across the table.\n\n' +
        'Reparations: ' + rep.total + 'cr (' + rep.base + 'cr base + ' + rep.days +
        ' war days \u00D7 ' + rep.perDay + 'cr + ' + rep.kills +
        ' of their ships destroyed \u00D7 ' + rep.perKill + 'cr).\n' +
        'Your standing: ' + standing + ' \u2192 ' + proj + ' after the payment (+' +
        STANDING_BOOST + ' goodwill).\n' +
        'Terms: the payment is taken up front. If your standing is still below ' +
        STANDING_REQ + ' after the payment, the talks FAIL, the ' + rep.total +
        'cr is gone, and the war continues.\n' +
        'Success ends the war immediately \u2014 no 10-day wait \u2014 and their ' +
        'patrols go quiet for ' + DEMIL_DAYS + ' days.';
      SF.Dialogue.open({
        title: '\uD83D\uDD4A\uFE0F Ceasefire talks \u2014 ' + fname(fid),
        text: text,
        choices: [
          { label: '\uD83D\uDD4A\uFE0F Pay ' + rep.total + 'cr \u2014 open ceasefire talks (' +
                   credits + 'cr on hand)',
            run: function () { self._resolveTalks(fid); } },
          { label: 'Walk away', run: function () { SF.Dialogue.close(); } }
        ]
      });
      return true;
    },

    _resolveTalks: function (fid) {
      installWraps();
      var r = this.talks(fid);
      if (r.ok) {
        SF.Dialogue.open({
          title: '\uD83D\uDD4A\uFE0F Ceasefire signed \u2014 ' + fname(fid),
          text: 'The envoy signs. "Done. Tell your guns to cool \u2014 ours already have."\n\n' +
            'The war is OVER, effective immediately. For the next ' + DEMIL_DAYS +
            ' days their patrols will not enter their systems, and their ships will treat ' +
            'you as neutral.\nTheir envoy will treat with you again whenever you wish \u2014 ' +
            'the 10-day lock is broken.',
          choices: [
            { label: 'Return to treaty talks', run: function () {
              try { SF.Treaties.negotiate(fid); } catch (e) { SF.Dialogue.close(); } } }
          ]
        });
      } else {
        var why = r.why === 'credits'
          ? 'You cannot cover the reparations: ' + r.have + 'cr on hand (need ' + r.need +
            'cr). The envoy does not wait for debtors.'
          : r.why === 'standing'
          ? 'They take your ' + r.paid + 'cr \u2014 and walk out. "Come back when your ' +
            'record does not precede you." Standing ' + r.have + ' (need ' + r.need +
            '+). The war continues.'
          : 'The talks cannot proceed. The war continues.';
        SF.Dialogue.open({
          title: '\uD83D\uDD4A\uFE0F Talks collapse \u2014 ' + fname(fid),
          text: why,
          choices: []
        });
      }
      return r.ok;
    },

    /* ---- test-only hooks ---- */
    testSetDemil: function (fid, daysAgo) {
      var r = rawRec(fid);
      if (!r) return false;
      var d = new Date(Date.now() - (daysAgo || 0) * 86400000);
      r.demilSince = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' +
        pad2(d.getUTCDate());
      return true;
    },
    testClear: function (fid) {
      var r = rawRec(fid);
      if (!r) return false;
      r.warKills = 0; r.demilSince = null;
      return true;
    }
  };

  /* ---- lazy wraps (factions.js loads before npcs.js, so SF.Dialogue
   * may not exist on first pass; the faction-treaties wraps must be
   * installed first so __cf chains outermost) ---- */
  function installWraps() {
    if (!window.SF) return;
    try { if (SF.Treaties && SF.Treaties.atWar) SF.Treaties.atWar('compact'); } catch (e) {}

    /* CEASEFIRE TALKS choice in the treaty negotiation dialogue while at war */
    (function () {
      var D = SF.Dialogue;
      if (!D || !D.open || D.open.__cf) return;
      var orig = D.open;
      var w = function (spec) {
        try {
          spec = spec || {};
          var choices = spec.choices || (spec.choices = []);
          var list = (window.SF && SF.FACTION_LIST) || [];
          for (var i = 0; i < list.length; i++) {
            var fid = list[i].id;
            if (spec.title && spec.title.indexOf('Treaty talks') >= 0 &&
                spec.title.indexOf(list[i].name) >= 0 &&
                window.SF && SF.Treaties && SF.Treaties.atWar(fid)) {
              var dup = false, j;
              for (j = 0; j < choices.length; j++)
                if (choices[j] && choices[j].__cf) { dup = true; break; }
              if (!dup) (function (f) {
                var rep = Ceasefire.reparationsFor(f);
                choices.push({
                  __cf: true,
                  label: '\uD83D\uDD4A\uFE0F CEASEFIRE TALKS \u2014 sue for peace (' +
                         rep.total + 'cr)',
                  run: function () { Ceasefire.negotiateTalks(f); }
                });
              })(fid);
              break;
            }
          }
        } catch (e) {}
        return orig.call(this, spec);
      };
      w.__cf = true;
      inheritMarks(w, orig);
      D.open = w;
    })();

    /* demilitarized stance reads 'neutral' through the patrolStance API
     * (a signed Pact's 'friendly' still wins — the pact supersedes) */
    (function () {
      var F = SF.Factions;
      if (!F || !F.patrolStance || F.patrolStance.__cf) return;
      var orig = F.patrolStance;
      var w = function (fid) {
        try {
          if (Ceasefire.demilActive(fid) &&
              !(window.SF && SF.Treaties && SF.Treaties.hasPact(fid)))
            return 'neutral';
        } catch (e) {}
        return orig.call(this, fid);
      };
      w.__cf = true;
      inheritMarks(w, orig);
      F.patrolStance = w;
    })();

    /* demilitarized: only the treaty faction's OWN ships stand down.
     * Pirates and rogues never signed your treaty — spawnPatrol runs
     * normally in their systems, and the wrap strips the treaty
     * faction's ships out of the spawn batch (they never fly; no kill
     * rewards, no standing side effects). */
    (function () {
      var E = SF.Enemies;
      if (!E || !E.spawnPatrol || E.spawnPatrol.__cf) return;
      var orig = E.spawnPatrol;
      var w = function (systemId, px, py) {
        var sysF = null, active = false;
        try {
          var map = (window.SF && SF.CONFIG && SF.CONFIG.trading &&
                     SF.CONFIG.trading.systemFaction) || {};
          sysF = map[systemId];
          active = !!(sysF && Ceasefire.demilActive(sysF));
        } catch (e) {}
        if (!active) return orig.call(this, systemId, px, py);
        // Demilitarized: let the patrol roll (pirates/rogues keep their
        // normal danger-weighted spawn rate), then strip the treaty
        // faction's ships from the batch before they ever fly.
        var nBefore = 0;
        try { nBefore = E.list.length; } catch (e2) { nBefore = 0; }
        var r = orig.call(this, systemId, px, py);
        try {
          var removed = 0, i, en;
          for (i = E.list.length - 1; i >= nBefore; i--) {
            en = E.list[i];
            if (en && en.faction === sysF) { E.list.splice(i, 1); removed++; }
          }
          if (removed > 0)
            toast('Hostiles on scope \u2014 ' + fname(sysF) +
              ' patrols stand down (ceasefire)');
        } catch (e3) {}
        return r;
      };
      w.__cf = true;
      inheritMarks(w, orig);
      E.spawnPatrol = w;
    })();

    /* count faction-ship kills while at war (reparations input).
     * Chains outside the faction-treaties __trt onKill wrap. */
    (function () {
      var F2 = SF.Factions;
      if (!F2 || !F2.onKill || F2.onKill.__cf) return;
      var orig2 = F2.onKill;
      var w = function (fid) {
        var r = orig2.call(this, fid);
        try {
          if (window.SF && SF.Treaties && SF.Treaties.atWar(fid)) {
            var rec = rawRec(fid);
            if (rec) {
              var k = rec.warKills;
              rec.warKills = ((isFinite(k) && k > 0) ? Math.floor(k) : 0) + 1;
            }
          }
        } catch (e) {}
        return r;
      };
      w.__cf = true;
      inheritMarks(w, orig2);
      F2.onKill = w;
    })();

    /* war and demilitarization are mutually exclusive: re-declaring war
     * during the window voids it and resets the kill count */
    (function () {
      var T = SF.Treaties;
      if (!T || !T.declareWar || T.declareWar.__cf) return;
      var origD = T.declareWar;
      var w = function (fid) {
        var r = origD.call(this, fid);
        try {
          if (r && r.ok) {
            var rec = rawRec(fid);
            if (rec) { rec.warKills = 0; rec.demilSince = null; }
          }
        } catch (e) {}
        return r;
      };
      w.__cf = true;
      inheritMarks(w, origD);
      T.declareWar = w;
    })();

    /* demilitarized state surfaces in the HQ treaty section */
    (function () {
      var T2 = SF.Treaties;
      if (!T2 || !T2.treatyStatusText || T2.treatyStatusText.__cf) return;
      var origS = T2.treatyStatusText;
      var w = function (fid) {
        var s = origS.call(this, fid);
        try {
          var left = Ceasefire.demilDaysLeft(fid);
          if (left > 0)
            s += ' \u00B7 \uD83D\uDD4A\uFE0F DEMILITARIZED (' + left + 'd of quiet)';
        } catch (e) {}
        return s;
      };
      w.__cf = true;
      inheritMarks(w, origS);
      T2.treatyStatusText = w;
    })();
  }

  /* public entry points install lazily, so tests and the dock flow work
   * even if the load listener hasn't fired yet */
  ['reparationsFor', 'warKillsOf', 'demilDaysLeft', 'demilActive',
   'demilStatusText', 'talks', 'negotiateTalks'].forEach(function (k) {
    var fn = Ceasefire[k];
    Ceasefire[k] = function () { installWraps(); return fn.apply(Ceasefire, arguments); };
  });

  SF.Ceasefire = Ceasefire;

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();
/* ============================================================
 * faction-envoy-flights phase: SF.Envoys — treaty envoy flights.
 *
 * While the pilot holds an active treaty with a faction — a
 * Non-Aggression Pact (SF.Treaties.hasPact) or a ceasefire/demilitarized
 * window (SF.Ceasefire.demilActive) — envoy ships fly scheduled routes
 * between the treaty factions' HQ stations:
 *
 *   leg 'out' : visible in the from-faction's HQ system, departing the
 *               HQ station for the system's jump point
 *   leg 'in'  : visible in the to-faction's HQ system, arriving from the
 *               jump point at the HQ station
 *
 * Envoys are runtime-only entities owned by this module (they live
 * outside SF.Enemies.list, so nothing targets them — they are neutral
 * and untargetable). They are drawn/updated by lazy __envoy wraps on
 * SF.Enemies.update / SF.Enemies.draw, so this file (js/factions.js) is
 * the ONLY file touched.
 *
 *   BREACH: a player (friendly) projectile that hits an envoy damages
 *     it; destroying it is a treaty breach — war re-declares with BOTH
 *     treaty factions and both standings drop 25.
 *   ESCORT: staying within ESCORT_RANGE (300px) for ESCORT_SECONDS
 *     (60s, accumulated while in range) grants +5 standing with both
 *     factions, once per envoy.
 *
 * Save-neutral: all envoy state is runtime-only and never serialized;
 * no SF.SAVE_VERSION bump. Announcements use SF.News.push only when
 * present. The star-map marker readout is rendered into the faction
 * panel ticker (starmap.js is outside this phase's file scope).
 *
 * Integration is additive-only:
 *   - wraps install lazily (factions.js loads before enemies.js and
 *     hud.js, so load order can't be trusted); every public entry point
 *     calls installWraps() first, plus a window load listener.
 *   - wrap-chain hygiene (treaty-ceasefire lesson): every __envoy
 *     wrapper inherits the inner function's __* marker flags so other
 *     phases' install guards keep seeing "installed".
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var ENVOY_SPEED = 95;      // px/s cruise
  var ENVOY_HP = 60;         // player bolts do ~5-20 dmg -> a few hits
  var ENVOY_RADIUS = 14;
  var FLIGHT_PERIOD = 200;   // seconds between departures per flight
  var ESCORT_RANGE = 300;    // px
  var ESCORT_SECONDS = 60;   // accumulated seconds in range
  var ESCORT_REWARD = 5;     // standing with each treaty faction
  var BREACH_PENALTY = 25;   // standing lost with each treaty faction
  var MAX_LIVE = 6;          // cap on visible envoys

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function fname(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].name : fid;
  }
  function fcolor(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].color : '#ffffff';
  }
  function fshort(fid) {
    return (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid])
      ? SF.FACTION_BY_ID[fid].short : fid;
  }
  function hqOf(fid) {
    if (window.SF && SF.FACTION_HQ) {
      for (var i = 0; i < SF.FACTION_HQ.length; i++)
        if (SF.FACTION_HQ[i].factionId === fid) return SF.FACTION_HQ[i];
    }
    return null;
  }
  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }
  function curSystem() {
    return (window.SF && SF.Game && typeof SF.Game.systemId === 'string') ? SF.Game.systemId : null;
  }
  function worldSize() {
    return (window.SF && SF.CONFIG && SF.CONFIG.worldSize) || 4200;
  }
  /* The jump point: a fixed deterministic in-system waypoint standing in
   * for the transit leg to another faction's HQ system. */
  function jumpPoint(ws) {
    return { x: ws - 420, y: 420 };
  }
  function flightKey(from, to) { return from + '>' + to; }

  /* Runtime-only state (never serialized). */
  var envoys = [];        // live envoy entities
  var flights = {};       // flightKey -> { next: seconds until next departure }
  var lastSystem = null;
  var seq = 0;
  var tickerEl = null;
  var tickerHTML = null;
  var tickerT = 0;

  var Envoys = {

    TUNE: { ENVOY_SPEED: ENVOY_SPEED, ENVOY_HP: ENVOY_HP,
            ENVOY_RADIUS: ENVOY_RADIUS, FLIGHT_PERIOD: FLIGHT_PERIOD,
            ESCORT_RANGE: ESCORT_RANGE, ESCORT_SECONDS: ESCORT_SECONDS,
            ESCORT_REWARD: ESCORT_REWARD, BREACH_PENALTY: BREACH_PENALTY,
            MAX_LIVE: MAX_LIVE },

    /* ---- treaty state ----
     * A faction is a "treaty faction" while the pilot holds a signed
     * Non-Aggression Pact or an active ceasefire/demil window with it. */
    treatyFactions: function () {
      installWraps();
      var out = [];
      if (!window.SF) return out;
      var T = SF.Treaties, C = SF.Ceasefire;
      ['compact', 'drifters', 'ember'].forEach(function (fid) {
        var pact = false, demil = false;
        try { pact = !!(T && T.hasPact && T.hasPact(fid)); } catch (e) {}
        try { demil = !!(C && C.demilActive && C.demilActive(fid)); } catch (e) {}
        if (pact || demil) out.push(fid);
      });
      return out;
    },

    /* ---- flights ----
     * Ordered pairs of distinct treaty factions. A flight is "scheduled":
     * its departures are spaced FLIGHT_PERIOD apart, staggered per pair. */
    activeFlights: function () {
      installWraps();
      var tf = this.treatyFactions();
      var out = [];
      for (var i = 0; i < tf.length; i++)
        for (var j = 0; j < tf.length; j++)
          if (i !== j) out.push({ from: tf[i], to: tf[j], key: flightKey(tf[i], tf[j]) });
      return out;
    },

    /* Live envoy entities (runtime-only). */
    list: function () { installWraps(); return envoys; },

    /* ---- test hooks ----
     * testSpawn forces an immediate departure (bypasses the schedule).
     * testClear wipes all envoys. */
    testSpawn: function (from, to) {
      installWraps();
      return spawnEnvoy(from, to, true);
    },
    testClear: function () {
      installWraps();
      envoys.length = 0;
      flights = {};
      return true;
    },

    /* ============================================================
     * per-frame update. Called from the __envoy wrap on
     * SF.Enemies.update (PLAYING only). p = SF.Player.
     * ============================================================ */
    update: function (dt, p, ws) {
      installWraps();
      if (!isFinite(dt) || dt <= 0) return;
      var sys = curSystem();
      if (sys !== lastSystem) {           // system switch: new skies
        envoys.length = 0;
        lastSystem = sys;
      }
      var tf = this.treatyFactions();
      if (!tf.length) {
        if (envoys.length) {
          envoys.length = 0;
          flights = {};
          toast('\u2709 Envoy flights suspended \u2014 no active treaties.');
        }
        return;
      }
      var tfSet = {};
      tf.forEach(function (f) { tfSet[f] = true; });

      /* prune envoys whose treaty lapsed mid-flight */
      for (var i = envoys.length - 1; i >= 0; i--) {
        var e = envoys[i];
        if (!tfSet[e.from] || !tfSet[e.to]) {
          envoys.splice(i, 1);
          news('\u2709 Envoy flight ' + fshort(e.from) + '\u2192' + fshort(e.to) +
            ' suspended \u2014 treaty lapsed.');
        }
      }

      scheduleDepartures(dt, tf, sys, ws);

      /* fly, escort, projectile hits */
      for (var k = envoys.length - 1; k >= 0; k--) {
        var ev = envoys[k];
        ev.t += dt;
        var dx = ev.tx - ev.x, dy = ev.ty - ev.y;
        var d = Math.hypot(dx, dy);
        var step = ENVOY_SPEED * dt;
        if (d <= step + 2) {
          /* arrived: jump out (departure) or dock in (arrival) */
          if (window.SF && SF.Particles)
            SF.Particles.burst(ev.x, ev.y, '#bfe9ff', 18, 160, 0.6, 3);
          envoys.splice(k, 1);
          var fl = flights[ev.key];
          if (fl) fl.next = FLIGHT_PERIOD;
          continue;
        }
        ev.x += dx / d * step;
        ev.y += dy / d * step;
        ev.angle = Math.atan2(dy, dx);

        if (p && isFinite(p.x) && isFinite(p.y)) {
          var prad = (typeof p.radius === 'function') ? p.radius() : 16;
          var pd = Math.hypot(p.x - ev.x, p.y - ev.y);

          /* escort: accumulate time in range */
          if (!ev.escortPaid && pd <= ESCORT_RANGE + prad) {
            ev.escortT += dt;
            if (!ev.escortHalf && ev.escortT >= ESCORT_SECONDS / 2) {
              ev.escortHalf = true;
              toast('\u2709 Escort ' + Math.round(ev.escortT) + 's/' + ESCORT_SECONDS +
                's \u2014 stay close to the envoy.');
            }
            if (ev.escortT >= ESCORT_SECONDS) {
              ev.escortPaid = true;
              if (window.SF && SF.Factions) {
                SF.Factions.shift(ev.from, ESCORT_REWARD);
                SF.Factions.shift(ev.to, ESCORT_REWARD);
              }
              toast('\u2709 ENVOY ESCORTED: ' + fname(ev.from) + ' +' + ESCORT_REWARD +
                ', ' + fname(ev.to) + ' +' + ESCORT_REWARD + ' standing.');
              news('\u2709 A freelance captain escorted a ' + fname(ev.from) +
                '\u2194' + fname(ev.to) + ' envoy flight its full route. +' +
                ESCORT_REWARD + ' standing with both.');
              if (window.SF && SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
              save();
            }
          }
        }
        ev.flash = Math.max(0, ev.flash - dt * 4);
      }

      checkProjectileHits(p);
    },

    /* ============================================================
     * draw. Called from the __envoy wrap on SF.Enemies.draw, after the
     * enemies render (world coords, camera already translated).
     * ============================================================ */
    draw: function (ctx) {
      installWraps();
      if (!ctx || !envoys.length) return;
      var p = (window.SF && SF.Player) ? SF.Player : null;
      var prad = 16;
      if (p) prad = (typeof p.radius === 'function') ? p.radius() : 16;
      for (var i = 0; i < envoys.length; i++) {
        var e = envoys[i];
        var col = fcolor(e.from);
        ctx.save();
        ctx.translate(e.x, e.y);
        /* courier beacon: pulsing white ring */
        var pr = ENVOY_RADIUS + 6 + 2.5 * Math.sin(e.t * 4);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.25 * Math.sin(e.t * 4)) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.stroke();
        /* hull: faction-colored diamond, white core, nose = heading */
        ctx.rotate(e.angle);
        ctx.fillStyle = e.flash > 0 ? '#ffffff' : col;
        ctx.beginPath();
        ctx.moveTo(ENVOY_RADIUS, 0);
        ctx.lineTo(0, ENVOY_RADIUS * 0.7);
        ctx.lineTo(-ENVOY_RADIUS * 0.8, 0);
        ctx.lineTo(0, -ENVOY_RADIUS * 0.7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = e.flash > 0 ? col : '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(-e.angle);
        /* envoy glyph */
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('\u2709', 0, -ENVOY_RADIUS - 10);
        /* escort progress ring while the player is in escort range */
        if (p && !e.escortPaid && isFinite(p.x)) {
          var pd = Math.hypot(p.x - e.x, p.y - e.y);
          if (pd <= ESCORT_RANGE + prad) {
            var frac = clamp(e.escortT / ESCORT_SECONDS, 0, 1);
            ctx.strokeStyle = '#7dffb0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, pr + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#7dffb0';
            ctx.font = '10px monospace';
            ctx.fillText(Math.round(frac * 100) + '%', 0, pr + 20);
          }
        }
        ctx.restore();
      }
    },

    /* ---- faction-panel readout ----
     * starmap.js is outside this phase's file scope, so the envoy marker
     * readout renders in the faction panel instead (a runtime ticker div
     * injected by the __envoy wrap on SF.HUD.init, refreshed on
     * SF.HUD.update). renderEnvoyPanel(el) lets any panel host the full
     * table. */
    envoyPanelHTML: function () {
      installWraps();
      var fl = this.activeFlights();
      var h = '<div class="sf-envoy" style="font-family:monospace;color:#cfe3ff;">' +
        '<div style="font-weight:bold;font-size:13px;margin-bottom:6px;letter-spacing:1px;">' +
        '\u2709 TREATY ENVOY FLIGHTS</div>';
      if (!fl.length) return h + '<div style="font-size:11px;color:#8ea3c4;">No active treaties \u2014 sign a pact or a ceasefire to open envoy routes.</div></div>';
      var self = this;
      fl.forEach(function (f) {
        var live = null;
        for (var i = 0; i < envoys.length; i++)
          if (envoys[i].key === f.key) { live = envoys[i]; break; }
        var hqA = hqOf(f.from), hqB = hqOf(f.to);
        var route = hqA ? hqA.name : fshort(f.from);
        route += ' \u2192 ' + (hqB ? hqB.name : fshort(f.to));
        var status, scolor;
        if (live) {
          status = live.leg === 'out' ? 'DEPARTING' : 'INBOUND';
          var esc = live.escortPaid ? ' \u00b7 escorted' :
            (live.escortT > 0 ? ' \u00b7 escort ' + Math.round(live.escortT) + 's' : '');
          status += esc;
          scolor = '#7dffb0';
        } else {
          var n = flights[f.key] ? Math.max(0, flights[f.key].next) : 0;
          status = 'next departure ~' + Math.ceil(n) + 's';
          scolor = '#8ea3c4';
        }
        h += '<div style="font-size:11px;margin:3px 0;display:flex;justify-content:space-between;gap:8px;">' +
          '<span><span style="color:' + fcolor(f.from) + ';">' + fshort(f.from) + '</span>' +
          '<span style="color:#8ea3c4;">\u2194</span>' +
          '<span style="color:' + fcolor(f.to) + ';">' + fshort(f.to) + '</span>' +
          ' <span style="color:#5d7396;">' + route + '</span></span>' +
          '<span style="color:' + scolor + ';">' + status + '</span></div>';
      });
      h += '<div style="font-size:10px;color:#5d7396;margin-top:4px;">Escort an envoy (300px, 60s) for +5/+5 standing. Attacking one breaches both treaties.</div>';
      return h + '</div>';
    },

    renderEnvoyPanel: function (el) {
      installWraps();
      var node = typeof el === 'string' ? document.getElementById(el) : el;
      if (!node) return false;
      node.innerHTML = this.envoyPanelHTML();
      return true;
    }
  };

  /* ---- departure scheduling ----
   * Each flight departs every FLIGHT_PERIOD seconds, staggered by pair
   * index. A departure is visible in the current system only on the leg
   * whose endpoint is here: 'out' in the from-faction's HQ system
   * (HQ station -> jump point), 'in' in the to-faction's HQ system
   * (jump point -> HQ station). */
  function scheduleDepartures(dt, tf, sys, ws) {
    var pairs = Envoys.activeFlights();
    for (var i = 0; i < pairs.length; i++) {
      var f = pairs[i];
      var fl = flights[f.key];
      if (!fl) { fl = flights[f.key] = { next: (i * 37) % FLIGHT_PERIOD }; }
      fl.next -= dt;
      if (fl.next > 0) continue;
      fl.next = FLIGHT_PERIOD;
      var hqA = hqOf(f.from), hqB = hqOf(f.to);
      if (!hqA || !hqB) continue;
      if (sys === hqA.systemId) spawnEnvoy(f.from, f.to, false);
      else if (sys === hqB.systemId) spawnEnvoy(f.from, f.to, false);
    }
  }

  function legFor(from, to, sys) {
    var hqA = hqOf(from), hqB = hqOf(to);
    if (!hqA || !hqB) return null;
    if (sys === hqA.systemId) return 'out';
    if (sys === hqB.systemId) return 'in';
    return null;
  }

  function spawnEnvoy(from, to, force) {
    var sys = curSystem();
    if (!sys) return null;
    var leg = legFor(from, to, sys);
    if (!leg && !force) return null;
    if (!leg) {
      /* test hook in a foreign system: pick the 'out' leg anyway */
      leg = 'out';
    }
    var key = flightKey(from, to);
    for (var i = 0; i < envoys.length; i++)
      if (envoys[i].key === key) return envoys[i]; // one live envoy per flight
    if (envoys.length >= MAX_LIVE) return null;
    var ws = worldSize();
    var jp = jumpPoint(ws);
    var hqA = hqOf(from), hqB = hqOf(to);
    var sx, sy, tx, ty;
    if (leg === 'out' && hqA) { sx = hqA.x; sy = hqA.y; tx = jp.x; ty = jp.y; }
    else if (leg === 'in' && hqB) { sx = jp.x; sy = jp.y; tx = hqB.x; ty = hqB.y; }
    else return null;
    var e = {
      id: 'envoy-' + (++seq),
      key: key, from: from, to: to, leg: leg,
      x: sx, y: sy, tx: tx, ty: ty,
      angle: Math.atan2(ty - sy, tx - sx),
      hp: ENVOY_HP, maxHp: ENVOY_HP, radius: ENVOY_RADIUS,
      t: 0, flash: 0, escortT: 0, escortHalf: false, escortPaid: false
    };
    envoys.push(e);
    var hqAName = hqA ? hqA.name : fshort(from);
    var hqBName = hqB ? hqB.name : fshort(to);
    news('\u2709 ENVOY FLIGHT \u2014 a ' + fname(from) + ' envoy departed ' + hqAName +
      ' for ' + hqBName + ' (' + fname(to) + '). Neutral courier \u2014 fire on it and both treaties burn.');
    return e;
  }

  /* ---- player fire hits an envoy ----
   * Envoys are neutral and untargetable, but bolts still fly. Any
   * friendly (player) projectile inside the envoy's hull damages it;
   * destroying it is a treaty breach with BOTH treaty factions. */
  function checkProjectileHits(p) {
    if (!envoys.length) return;
    if (!window.SF || !SF.Projectiles || !SF.Projectiles.pool) return;
    var pool = SF.Projectiles.pool;
    for (var i = 0; i < pool.length; i++) {
      var pr = pool[i];
      if (!pr.active || !pr.friendly) continue;
      for (var k = envoys.length - 1; k >= 0; k--) {
        var e = envoys[k];
        var rr = e.radius + (pr.radius || 3);
        var dx = pr.x - e.x, dy = pr.y - e.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        pr.active = false;
        e.hp -= (pr.dmg || 5);
        e.flash = 1;
        if (window.SF && SF.Particles)
          SF.Particles.burst(e.x, e.y, '#ffffff', 8, 140, 0.4, 2);
        if (e.hp <= 0) {
          envoys.splice(k, 1);
          breach(e);
        }
        break; // one envoy per bolt
      }
    }
  }

  function breach(e) {
    var fromName = fname(e.from), toName = fname(e.to);
    if (window.SF && SF.Particles) {
      SF.Particles.burst(e.x, e.y, fcolor(e.from), 30, 260, 0.9, 4);
      SF.Particles.burst(e.x, e.y, '#ff5e3a', 20, 200, 0.8, 3);
    }
    /* War re-declares with both treaty factions (declareWar is
     * idempotent; the ceasefire __cf wrap on it also voids any demil
     * window). The breach costs EXACTLY BREACH_PENALTY standing per
     * faction: snapshot first, then set the net delta, so declareWar's
     * own -15 war-declaration penalty doesn't stack on top. */
    if (window.SF && SF.Factions) {
      var s0from = SF.Factions.standing(e.from);
      var s0to = SF.Factions.standing(e.to);
      if (window.SF && SF.Treaties) {
        try { SF.Treaties.declareWar(e.from); } catch (err) {}
        try { SF.Treaties.declareWar(e.to); } catch (err) {}
      }
      SF.Factions.shift(e.from, (s0from - BREACH_PENALTY) - SF.Factions.standing(e.from));
      SF.Factions.shift(e.to, (s0to - BREACH_PENALTY) - SF.Factions.standing(e.to));
    } else if (window.SF && SF.Treaties) {
      try { SF.Treaties.declareWar(e.from); } catch (err) {}
      try { SF.Treaties.declareWar(e.to); } catch (err) {}
    }
    toast('\u2620 TREATY BREACH \u2014 you destroyed a ' + fromName + '\u2194' + toName +
      ' envoy! War re-declared. -' + BREACH_PENALTY + ' standing with both.');
    news('\u2620 TREATY BREACH \u2014 a freelance captain destroyed a neutral ' +
      fromName + '\u2194' + toName + ' envoy flight. Both factions declare war. (-' +
      BREACH_PENALTY + ' standing each)');
    if (window.SF && SF.Audio && SF.Audio.sfx) {
      try { SF.Audio.sfx('treaty_broken'); } catch (err) {}
    }
    var fl = flights[e.key];
    if (fl) fl.next = FLIGHT_PERIOD;
    save();
  }

  /* ============================================================
   * Lazy wrap installation. factions.js loads before enemies.js and
   * hud.js, so none of the wrap targets exist at this section's load
   * time. installWraps() is idempotent; called from every public entry
   * point plus window load.
   * ============================================================ */
  var _installed = false;

  /* Copy the inner function's __* marker flags onto the wrapper so
   * other phases' install guards keep seeing "installed" (treaty-
   * ceasefire wrap-chain hygiene). */
  function inheritMarkers(outer, inner) {
    if (!outer || !inner) return;
    try {
      Object.keys(inner).forEach(function (k) {
        if (k.slice(0, 2) === '__' && !(k in outer)) outer[k] = inner[k];
      });
    } catch (e) { /* never break installs */ }
  }

  function installWraps() {
    if (_installed) return;
    if (!window.SF || !SF.Enemies || !SF.HUD) return;
    _installed = true;

    /* ---- update hook: fly envoys after the enemies tick ---- */
    (function () {
      var E = SF.Enemies;
      var orig = E && E.update;
      if (!orig || orig.__envoy) return;
      var w = function (dt, p, ws) {
        var r = orig.apply(this, arguments);
        try {
          if (window.SF && SF.Envoys) SF.Envoys.update(dt, p, ws);
        } catch (e) { /* never break the frame loop */ }
        return r;
      };
      inheritMarkers(w, orig);
      w.__envoy = true;
      E.update = w;
    })();

    /* ---- draw hook: envoys after the enemies render ---- */
    (function () {
      var E = SF.Enemies;
      var orig = E && E.draw;
      if (!orig || orig.__envoy) return;
      var w = function (ctx) {
        orig.apply(this, arguments);
        try {
          if (window.SF && SF.Envoys) SF.Envoys.draw(ctx);
        } catch (e) { /* never break the frame loop */ }
      };
      inheritMarkers(w, orig);
      w.__envoy = true;
      E.draw = w;
    })();

    /* ---- HUD ticker: runtime DOM, no index.html edit ----
     * Faction-panel envoy readout (starmap.js is outside this phase's
     * file scope, so the marker readout lives here). The ticker element
     * is created right here in installWraps (the game's one-time
     * SF.HUD.init may already have run, so it is not wrapped); the
     * SF.HUD.update wrap only refreshes its text. */
    (function () {
      try {
        if (!tickerEl && typeof document !== 'undefined' && document.body) {
          tickerEl = document.createElement('div');
          tickerEl.id = 'sf-envoy-ticker';
          tickerEl.style.cssText =
            'position:fixed;top:6px;left:50%;transform:translateX(-50%);' +
            'z-index:40;pointer-events:none;display:none;' +
            'background:rgba(8,14,26,0.78);border:1px solid #2a3a55;' +
            'border-radius:6px;padding:3px 10px;font-family:monospace;' +
            'font-size:11px;color:#cfe3ff;white-space:nowrap;';
          document.body.appendChild(tickerEl);
        }
      } catch (e) { /* headless-safe */ }
    })();

    (function () {
      var H = SF.HUD;
      var orig = H && H.update;
      if (!orig || orig.__envoyUpdate) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try { refreshTicker(); } catch (e) { /* never break the HUD */ }
        return r;
      };
      inheritMarkers(w, orig);
      w.__envoyUpdate = true;
      H.update = w;
    })();
  }

  /* ~4Hz ticker refresh; only touches the DOM when the text changed. */
  function refreshTicker() {
    if (!tickerEl && typeof document !== 'undefined' && document.body) {
      /* install ran pre-DOM: create now (same guard as installWraps) */
      try {
        tickerEl = document.createElement('div');
        tickerEl.id = 'sf-envoy-ticker';
        tickerEl.style.cssText =
          'position:fixed;top:6px;left:50%;transform:translateX(-50%);' +
          'z-index:40;pointer-events:none;display:none;' +
          'background:rgba(8,14,26,0.78);border:1px solid #2a3a55;' +
          'border-radius:6px;padding:3px 10px;font-family:monospace;' +
          'font-size:11px;color:#cfe3ff;white-space:nowrap;';
        document.body.appendChild(tickerEl);
      } catch (e) { return; }
    }
    if (!tickerEl) return;
    tickerT++;
    if (tickerT % 15 !== 0) return;
    var fl = Envoys.activeFlights();
    if (!fl.length) {
      if (tickerHTML !== '') { tickerHTML = ''; tickerEl.style.display = 'none'; }
      return;
    }
    var bits = [];
    for (var i = 0; i < fl.length; i++) {
      var f = fl[i];
      var live = null;
      for (var j = 0; j < envoys.length; j++)
        if (envoys[j].key === f.key) { live = envoys[j]; break; }
      var tag = '<span style="color:' + fcolor(f.from) + '">' + fshort(f.from) + '</span>' +
        '<span style="color:#8ea3c4">\u2194</span>' +
        '<span style="color:' + fcolor(f.to) + '">' + fshort(f.to) + '</span>';
      if (live) {
        var esc = live.escortPaid ? ' \u2714' :
          (live.escortT > 0 ? ' ' + Math.round(live.escortT) + 's' : '');
        tag += ' <span style="color:#7dffb0">EN ROUTE' + esc + '</span>';
      }
      bits.push('\u2709' + tag);
    }
    var html = bits.join(' &nbsp;\u00b7&nbsp; ');
    if (html !== tickerHTML) {
      tickerHTML = html;
      tickerEl.innerHTML = html;
      tickerEl.style.display = 'block';
    }
  }

  /* public entry points install lazily, so the wraps land even if the
   * load listener hasn't fired yet */
  ['treatyFactions', 'activeFlights', 'list', 'testSpawn', 'testClear',
   'update', 'draw', 'envoyPanelHTML', 'renderEnvoyPanel'].forEach(function (k) {
    var fn = Envoys[k];
    Envoys[k] = function () { installWraps(); return fn.apply(Envoys, arguments); };
  });

  SF.Envoys = Envoys;

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();

/* ============================================================
 * STARFALL — Phase 5: Trading + Player Homebase
 *
 * SF.Trading: 6 goods, per-system price multipliers, per-station
 * markets that drift +/-8% per dock visit (clamped 0.5–2.0) with
 * trend arrows, 5% better prices when the system's faction
 * standing is >= 25. Cargo: ore + goods share the hold.
 *
 * SF.Homebase: player-owned station (25,000c, placeable in any
 * discovered system). Hangar (8 ships), armory (part storage),
 * vault (credit storage), companion reserves, mission board with
 * waypoint set/clear. Works through station.js multi-station
 * support: dock(st) / allStations().
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ============================ TRADING ============================ */

  function tcfg() { return SF.CONFIG.trading; }

  /* b4-sprite-lighting: UI icon wiring, same contract as station.js
   * storeIcon — resolved through SF.Sprites (get() warms the cache,
   * urlFor() supplies the <img> src); missing icon degrades to text
   * via onerror. Wave 4 completed the set: all six goods now have a
   * g_* icon (fuel/minerals/elec/lux drawn locally, see phases
   * twelve-hour-wave4/gen-icons.py). */
  function tradeIcon(iconId, size) {
    var px = size || 28, url = '';
    try {
      if (window.SF && SF.Sprites) {
        SF.Sprites.get('ui', 'icons/' + iconId);
        url = SF.Sprites.urlFor('ui', 'icons/' + iconId);
      }
    } catch (e) {}
    if (!url) url = 'assets/ui/icons/' + iconId + '.png';
    return '<img class="store-icon" src="' + url + '" alt="" ' +
      'style="width:' + px + 'px;height:' + px + 'px;object-fit:contain;flex:none" ' +
      'onerror="this.style.display=\'none\'">';
  }
  function goodIcon(gid) {
    var m = { food: 'g_food', fuel: 'g_fuel', minerals: 'g_minerals',
      meds: 'g_meds', elec: 'g_elec', lux: 'g_lux' };
    return m[gid] || null;
  }

  function goodsDef(id) {
    var gs = tcfg().goods;
    for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i];
    return null;
  }

  function markets() {
    // persisted on the player blob (save v5)
    var m = SF.Player.markets;
    if (!m) { m = {}; }
    return m;
  }

  function stationKey(st) { return SF.Game.systemId + ':' + st.name; }

  function ensureMarket(st) {
    var key = stationKey(st);
    var mk = markets();
    if (!mk[key]) {
      mk[key] = {};
      tcfg().goods.forEach(function (g) { mk[key][g.id] = { m: 1, prev: 1 }; });
    }
    return mk[key];
  }

  function systemFaction() {
    var fid = tcfg().systemFaction[SF.Game.systemId];
    return (window.SF && SF.Factions && fid) ? SF.Factions.standing(fid) : 0;
  }

  var Trading = {

    stationKey: stationKey,

    /* Drift every market multiplier +/-8%, clamp 0.5–2.0. Called on dock.
     * trade-contracts: fresh contract offers each dock visit. */
    drift: function (st) {
      var mk = ensureMarket(st), c = tcfg();
      var self = this;
      if (window.SF && SF.Contracts) SF.Contracts.refreshOffers(st);
      /* trade-intel: a scanner ping queues exact future ticks per station;
       * consume one per dock so the forecast matches reality. Additive —
       * a null forecast falls through to the original random drift. */
      var forecast = (window.SF && SF.TradeIntel) ? SF.TradeIntel.takeTick(st) : null;
      Object.keys(mk).forEach(function (gid) {
        var e = mk[gid];
        e.prev = e.m;
        if (forecast && typeof forecast[gid] === 'number') {
          e.m = forecast[gid];
        } else {
          e.m = clamp(e.m * (1 + (Math.random() * 2 - 1) * c.driftPct), c.driftMin, c.driftMax);
          e.m = Math.round(e.m * 1000) / 1000;
        }
        // planets-facilities: big market moves make the wire
        var chg = (e.m - e.prev) / Math.max(0.001, e.prev);
        if (Math.abs(chg) > 0.10 && window.SF && SF.News) {
          var gd = gid;
          (SF.CONFIG.trading.goods || []).forEach(function (g2) { if (g2.id === gid) gd = g2.name; });
          SF.News.push('\uD83D\uDCC8 Market watch: ' + gd + ' ' +
            (chg > 0 ? 'spiked +' : 'crashed ') + Math.round(chg * 100) + '% at ' + st.name + '.');
        }
      });
    },

    trendArrow: function (st, goodId) {
      var e = ensureMarket(st)[goodId];
      if (!e) return '–';
      if (e.m > e.prev * 1.001) return '▲';
      if (e.m < e.prev * 0.999) return '▼';
      return '–';
    },

    /* unit price. side: 'buy' (player buys) or 'sell'. */
    price: function (st, goodId, side) {
      var g = goodsDef(goodId);
      if (!g) return 0;
      var sysMul = (tcfg().systemMul[SF.Game.systemId] || {})[goodId] || 1;
      var mkt = ensureMarket(st)[goodId].m;
      var base = g.base * sysMul * mkt;
      var c = tcfg();
      if (side === 'buy') {
        var pb = base * (systemFaction() >= c.standingNeed ? c.standingCut : 1);
        return Math.max(1, Math.ceil(pb));
      }
      var ps = base * c.sellSpread * (systemFaction() >= c.standingNeed ? c.standingBonus : 1);
      return Math.max(1, Math.floor(ps));
    },

    buy: function (st, goodId, n) {
      var p = SF.Player;
      n = n || 1;
      var cost = this.price(st, goodId, 'buy') * n;
      if (p.credits < cost) return false;
      if (p.cargoUsed() + n > p.cargoSpace()) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Cargo hold full!');
        return false;
      }
      p.credits -= cost;
      var gs = p.goods || {};
      gs[goodId] = (gs[goodId] || 0) + n;
      return true;
    },

    sell: function (st, goodId, n) {
      var p = SF.Player;
      n = n || 1;
      var have = (p.goods || {})[goodId] || 0;
      if (have < n) return false;
      p.goods[goodId] -= n;
      p.credits += this.price(st, goodId, 'sell') * n;
      return true;
    },

    /* ---- station UI ---- */
    renderMarket: function (body, st) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.innerHTML = tradeIcon('s_market', 20) + 'TRADING';
      body.appendChild(h);
      var c = tcfg();
      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '4px';
      var disc = systemFaction() >= c.standingNeed;
      note.textContent = 'Prices drift every visit (trend ▲▼). ' +
        (disc ? '5% better prices here — your standing buys respect.' : 'Reach standing ' +
        c.standingNeed + ' with the local faction for 5% better prices.') +
        ' Cargo: ' + SF.Player.cargoUsed() + '/' + SF.Player.cargoSpace() + 't';
      body.appendChild(note);
      var self = this;
      c.goods.forEach(function (g) {
        var have = (SF.Player.goods || {})[g.id] || 0;
        var bp = self.price(st, g.id, 'buy');
        var sp = self.price(st, g.id, 'sell');
        var arrow = self.trendArrow(st, g.id);
        var div = document.createElement('div');
        div.className = 'store-row';
        var gi = goodIcon(g.id);
        div.innerHTML = '<div class="store-info">' + (gi ? tradeIcon(gi) : '') + '<div>' +
          '<div class="store-name">' + g.name + ' <span class="dim">' + arrow + '</span>' +
          (have > 0 ? ' <span style="color:#3ddc5f">×' + have + 't in hold</span>' : '') + '</div>' +
          '<div class="store-desc">BUY ' + fmt(bp) + 'c/t · SELL ' + fmt(sp) + 'c/t</div></div></div>';
        var bb = document.createElement('button');
        bb.className = 'btn store-btn';
        bb.textContent = 'BUY +1t';
        var full = SF.Player.cargoUsed() >= SF.Player.cargoSpace();
        if (SF.Player.credits < bp || full) {
          bb.disabled = true;
          bb.title = full ? 'Cargo full' : 'Not enough credits';
        }
        bb.addEventListener('click', function () {
          if (self.buy(st, g.id, 1)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          else SF.Audio.deny();
        });
        div.appendChild(bb);
        var sb = document.createElement('button');
        sb.className = 'btn store-btn';
        sb.textContent = 'SELL +1t';
        if (have <= 0) { sb.disabled = true; }
        sb.addEventListener('click', function () {
          if (self.sell(st, g.id, 1)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          else SF.Audio.deny();
        });
        div.appendChild(sb);
        body.appendChild(div);
      });
      // trade-contracts: bulk delivery contracts panel (accept, countdowns, turn-ins)
      if (window.SF && SF.Contracts) SF.Contracts.renderContracts(body, st);
    },

    /* ---- smuggling-runs: the station fence ----
     * Stations quietly buy hot goods at fenceMul x street price (2-3x normal
     * margins) — if you made it past customs with the cargo. */
    fencePrice: function (goodId) {
      var g = (SF.CONTRABAND_BY_ID || {})[goodId];
      if (!g) return 0;
      return Math.ceil(g.base * SF.CONFIG.contraband.fenceMul);
    },

    sellContraband: function (goodId, n) {
      var p = SF.Player, inv = p.contraband || {};
      n = n || 1;
      if ((inv[goodId] || 0) < n) return false;
      inv[goodId] -= n;
      if (inv[goodId] <= 0) delete inv[goodId];
      p.contraband = inv;
      p.credits += this.fencePrice(goodId) * n;
      return true;
    },

    renderFence: function (body, st) {
      if (!st || (st.kind !== 'dock' && st.kind !== 'homebase')) return;
      var inv = SF.Player.contraband || {};
      var ids = Object.keys(inv).filter(function (k) { return inv[k] > 0; });
      if (!ids.length) return;
      var h = document.createElement('div');
      h.className = 'store-head';
      h.innerHTML = tradeIcon('s_fence', 20) + 'CONTRABAND FENCE';
      body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'dim'; note.style.marginBottom = '4px';
      note.textContent = 'No questions asked. Fences pay ' +
        SF.CONFIG.contraband.fenceMul + '× street price — if you made it past customs.';
      body.appendChild(note);
      var self = this;
      ids.forEach(function (gid) {
        var g = SF.CONTRABAND_BY_ID[gid];
        if (!g) return;
        var sp = self.fencePrice(gid);
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info">' + tradeIcon('g_contraband') + '<div><div class="store-name">' + g.name +
          ' <span style="color:#e8b339">×' + inv[gid] + 't in hold</span></div>' +
          '<div class="store-desc">Fence pays ' + fmt(sp) + 'c/t</div></div></div>';
        var sb = document.createElement('button');
        sb.className = 'btn store-btn';
        sb.textContent = 'SELL +1t';
        sb.addEventListener('click', function () {
          if (self.sellContraband(gid, 1)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          else SF.Audio.deny();
        });
        div.appendChild(sb);
        body.appendChild(div);
      });
    }
  };

  SF.Trading = Trading;

/* ============================================================
 * trade-contracts phase: SF.Contracts — bulk delivery contracts.
 *
 * Stations post bulk contracts (deliver N tons of <good> to <station>
 * within T minutes; reward credits + faction standing). Accept from the
 * market UI, track in the contracts panel with a live countdown,
 * turn in at the destination market. Expiry = small standing hit,
 * no cargo loss. Additive on the existing trading code.
 *
 * Persistence: additive on the existing markets blob
 * (SF.Player.markets._contracts), defensive reads everywhere —
 * save-neutral, SF.SAVE_VERSION is NOT bumped.
 * ============================================================ */

SF.CONFIG.contracts = SF.CONFIG.contracts || {
  offersPerDock: [2, 3],   // offers rolled per station per dock
  tons: [5, 28],           // N range
  deadlineMin: [12, 18],   // T range in minutes
  rewardMul: 1.5,          // reward = qty * good.base * rewardMul (x1.5 cross-system)
  standingReward: [4, 8],  // standing gained with the destination faction
  expiryHit: 3,            // standing lost with the issuing faction on expiry
  maxActive: 6
};

(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- persistent blob (defensive) ---------- */
  function blob() {
    var p = SF.Player;
    if (!p.markets || typeof p.markets !== 'object') p.markets = {};
    var c = p.markets._contracts;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      c = { offers: {}, active: [] };
      p.markets._contracts = c;
    }
    if (!c.offers || typeof c.offers !== 'object' || Array.isArray(c.offers)) c.offers = {};
    if (!Array.isArray(c.active)) c.active = [];
    return c;
  }

  function stKey(sysId, name) { return sysId + ':' + name; }

  /* ---------- destination stations (docks + HQs only — full market UI) ---------- */
  function destStations() {
    var out = [];
    (SF.SYSTEMS || []).forEach(function (sys) {
      if (sys.station && sys.station.name)
        out.push({ systemId: sys.id, name: sys.station.name });
    });
    (SF.FACTION_HQ || []).forEach(function (hq) {
      out.push({ systemId: hq.systemId, name: hq.name });
    });
    return out;
  }

  function rollOffer(issueSys, issueStation) {
    var goods = (SF.CONFIG.trading && SF.CONFIG.trading.goods) || [];
    if (!goods.length) return null;
    var g = goods[rint(0, goods.length - 1)];
    var dests = destStations().filter(function (d) {
      return !(d.systemId === issueSys && d.name === issueStation);
    });
    if (!dests.length) return null;
    var d = dests[rint(0, dests.length - 1)];
    var cfg = SF.CONFIG.contracts;
    var qty = rint(cfg.tons[0], cfg.tons[1]);
    var tMin = rint(cfg.deadlineMin[0], cfg.deadlineMin[1]);
    var cross = d.systemId !== issueSys;
    return {
      id: 'c' + Date.now().toString(36) + rint(100, 999),
      goodId: g.id, goodName: g.name,
      qty: qty,
      issueSystem: issueSys, issueStation: issueStation,
      destSystem: d.systemId, destStation: d.name,
      factionId: (SF.CONFIG.trading.systemFaction || {})[d.systemId] || null,
      issueFaction: (SF.CONFIG.trading.systemFaction || {})[issueSys] || null,
      reward: Math.round(qty * g.base * cfg.rewardMul * (cross ? 1.5 : 1)),
      standing: rint(cfg.standingReward[0], cfg.standingReward[1]),
      minutes: tMin,
      deadline: null,       // set on accept
      acceptedAt: null,
      state: 'offer'
    };
  }

  function fmtClock(ms) {
    if (ms <= 0) return '0:00';
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  var Contracts = {

    /* ---- offers ---- */
    refreshOffers: function (st) {
      var sysId = SF.Game.systemId, name = st && st.name ? st.name : (SF.Game.dockedAt || '');
      var b = blob();
      var cfg = SF.CONFIG.contracts;
      var n = rint(cfg.offersPerDock[0], cfg.offersPerDock[1]);
      var arr = [];
      for (var i = 0; i < n; i++) {
        var o = rollOffer(sysId, name);
        if (o) arr.push(o);
      }
      b.offers[stKey(sysId, name)] = arr;
    },

    offers: function (st) {
      var key = stKey(SF.Game.systemId, st && st.name ? st.name : (SF.Game.dockedAt || ''));
      var b = blob();
      if (!b.offers[key]) this.refreshOffers(st);
      return b.offers[key] || [];
    },

    active: function () {
      return blob().active.slice();
    },

    /* ---- accept / turn-in / expiry ---- */
    accept: function (offerId) {
      var b = blob(), cfg = SF.CONFIG.contracts;
      if (b.active.length >= cfg.maxActive) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Contract log full — finish one first.');
        return false;
      }
      var sysId = SF.Game.systemId, name = SF.Game.dockedAt || '';
      var arr = b.offers[stKey(sysId, name)] || [];
      var i = -1;
      for (var k = 0; k < arr.length; k++) if (arr[k].id === offerId) { i = k; break; }
      if (i < 0) return false;
      var c = arr.splice(i, 1)[0];
      c.acceptedAt = Date.now();
      c.deadline = c.acceptedAt + c.minutes * 60000;
      c.state = 'active';
      b.active.push(c);
      if (window.SF && SF.News) SF.News.push('📝 Contract accepted: deliver ' + c.qty +
        't ' + c.goodName + ' to ' + c.destStation + ' within ' + c.minutes + ' min. +' +
        fmt(c.reward) + 'c on delivery.');
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Contract accepted: ' + c.qty + 't ' + c.goodName +
        ' → ' + c.destStation);
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('contract_accept');
      return true;
    },

    atDestination: function (c) {
      return SF.Game.systemId === c.destSystem && (SF.Game.dockedAt || '') === c.destStation;
    },

    turnIn: function (contractId) {
      var b = blob();
      var i = -1;
      for (var k = 0; k < b.active.length; k++) if (b.active[k].id === contractId) { i = k; break; }
      if (i < 0) return false;
      var c = b.active[i];
      if (!this.atDestination(c)) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Turn in at ' + c.destStation + '.');
        return false;
      }
      var have = (SF.Player.goods || {})[c.goodId] || 0;
      if (have < c.qty) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Need ' + c.qty + 't of ' + c.goodName +
          ' in hold (' + have + 't aboard).');
        return false;
      }
      SF.Player.goods[c.goodId] -= c.qty;
      var p = SF.Player, cr0 = p.credits;
      p.credits += c.reward;
      var st0 = (window.SF && SF.Factions && c.factionId) ? SF.Factions.standing(c.factionId) : null;
      if (window.SF && SF.Factions && c.factionId) SF.Factions.shift(c.factionId, c.standing);
      b.active.splice(i, 1);
      if (window.SF && SF.News) SF.News.push('✅ Contract fulfilled: ' + c.qty + 't ' +
        c.goodName + ' delivered to ' + c.destStation + '. +' + fmt(c.reward) + 'c, +' +
        c.standing + ' standing.');
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Contract fulfilled: +' + fmt(c.reward) + 'c');
      if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
      if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('contract_turnin');
      return { creditsDelta: p.credits - cr0,
               standingDelta: st0 === null ? null : SF.Factions.standing(c.factionId) - st0 };
    },

    /* expiry check; cheap enough to run per frame + per market render */
    tick: function (now) {
      now = now || Date.now();
      var b = blob(), cfg = SF.CONFIG.contracts, self = this;
      var expired = b.active.filter(function (c) { return c.deadline && now >= c.deadline; });
      if (!expired.length) return [];
      b.active = b.active.filter(function (c) { return !(c.deadline && now >= c.deadline); });
      expired.forEach(function (c) {
        // standing hit with the ISSUING faction; cargo stays in the hold (no cargo loss)
        if (window.SF && SF.Factions && c.issueFaction) SF.Factions.shift(c.issueFaction, -cfg.expiryHit);
        if (window.SF && SF.News) SF.News.push('⏰ Contract expired: ' + c.qty + 't ' +
          c.goodName + ' never reached ' + c.destStation + '. ' +
          (c.issueFaction ? 'Standing -' + cfg.expiryHit + '.' : '') + ' Cargo is yours to keep.');
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('⏰ Contract expired: ' + c.goodName + ' deal lapsed');
        if (SF.Audio && SF.Audio.questFail) SF.Audio.questFail();
        if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('contract_expire');
      });
      return expired.map(function (c) { return c.id; });
    },

    /* ---- market UI ---- */
    renderContracts: function (body, st) {
      this.tick(); // docked-side expiry processing
      var self = this;
      var sysId = SF.Game.systemId, name = st && st.name ? st.name : (SF.Game.dockedAt || '');

      // offers
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '📝 BULK TRADE CONTRACTS';
      body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '4px';
      note.textContent = 'Stations pay a premium for bulk hauls. Deliver before the clock runs out — ' +
        'late deals cost you standing, but never your cargo.';
      body.appendChild(note);

      var offs = this.offers(st);
      if (!offs.length) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.textContent = 'No contracts posted right now. Check another station.';
        body.appendChild(none);
      }
      offs.forEach(function (o) {
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div>' +
          '<div class="store-name">Deliver ' + o.qty + 't ' + o.goodName +
          ' <span class="dim">→ ' + o.destStation + '</span></div>' +
          '<div class="store-desc">+' + fmt(o.reward) + 'c · +' + o.standing +
          ' standing · due in ' + o.minutes + ' min</div></div></div>';
        var ab = document.createElement('button');
        ab.className = 'btn store-btn';
        ab.textContent = 'ACCEPT';
        ab.addEventListener('click', function () {
          if (self.accept(o.id)) { SF.Save.save(); SF.Station.renderStore(); }
          else SF.Audio.deny();
        });
        div.appendChild(ab);
        body.appendChild(div);
      });

      // active contracts
      var act = this.active();
      if (act.length) {
        var h2 = document.createElement('div');
        h2.className = 'store-desc';
        h2.style.cssText = 'margin:10px 0 2px;letter-spacing:2px;';
        h2.textContent = '— ACTIVE CONTRACTS (' + act.length + ') —';
        body.appendChild(h2);
        var now = Date.now();
        act.forEach(function (c) {
          var at = self.atDestination(c);
          var have = (SF.Player.goods || {})[c.goodId] || 0;
          var div = document.createElement('div');
          div.className = 'store-row';
          var clock = at ? 'AT DESTINATION' : fmtClock(c.deadline - now);
          div.innerHTML = '<div class="store-info"><div>' +
            '<div class="store-name">' + c.qty + 't ' + c.goodName + ' → ' + c.destStation +
            ' <span style="color:' + (at ? '#3ddc5f' : '#e8b339') + '">' + clock + '</span></div>' +
            '<div class="store-desc">+' + fmt(c.reward) + 'c · +' + c.standing +
            ' standing · ' + have + 't/' + c.qty + 't in hold</div></div></div>';
          var tb = document.createElement('button');
          tb.className = 'btn store-btn';
          if (at) {
            tb.textContent = have >= c.qty ? 'TURN IN' : 'NEED ' + c.qty + 't';
            tb.disabled = have < c.qty;
            tb.addEventListener('click', function () {
              if (self.turnIn(c.id)) { SF.Save.save(); SF.Station.renderStore(); }
              else SF.Audio.deny();
            });
          } else {
            tb.textContent = 'FLY THERE';
            tb.disabled = true;
            tb.title = 'Undock and travel to ' + c.destStation;
          }
          div.appendChild(tb);
          body.appendChild(div);
        });
      }
    }
  };

  SF.Contracts = Contracts;
})();
  /* ============================ HOMEBASE ============================ */

  var HB_COST = 25000;
  var HANGAR_CAP = 8;

  function hb() { return SF.Player.homebase; }

  function compDef(id) {
    if (window.SF && SF.Companions && SF.Companions.byId) return SF.Companions.byId[id];
    return null;
  }

  var MISSION_KINDS = [
    { kind: 'bounty', label: 'Bounty', verbs: ['A pirate ace', 'A rogue gunship', 'A mutinous raider'] },
    { kind: 'survey', label: 'Survey', verbs: ['An uncharted wreck', 'A rich asteroid cluster', 'A nav beacon'] },
    { kind: 'cache',  label: 'Cache',  verbs: ['A smuggler cache', 'A supply drop', 'A forgotten vault'] }
  ];

  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function rollMission() {
    var k = MISSION_KINDS[rint(0, MISSION_KINDS.length - 1)];
    var sys = SF.SYSTEMS[rint(0, SF.SYSTEMS.length - 1)];
    var ws = SF.CONFIG.worldSize;
    return {
      id: 'm' + Date.now().toString(36) + rint(100, 999),
      kind: k.kind,
      text: k.verbs[rint(0, k.verbs.length - 1)] + ' reported in ' + sys.name + '.',
      reward: rint(300, 600) + (sys.id === 'ember' ? 250 : 0),
      systemId: sys.id,
      x: rint(400, ws - 400), y: rint(400, ws - 400)
    };
  }

  var Homebase = {
    COST: HB_COST,

    get: function () { return hb() || null; },

    exists: function () { return !!hb(); },

    /* Purchase: places the station in the current system at the player's position. */
    buy: function () {
      var p = SF.Player;
      if (this.exists()) return false;
      if (p.credits < HB_COST) return false;
      if (SF.Game.discovered.indexOf(SF.Game.systemId) < 0) return false;
      p.credits -= HB_COST;
      var ws = SF.CONFIG.worldSize;
      p.homebase = {
        name: 'Home Base',
        systemId: SF.Game.systemId,
        x: Math.max(200, Math.min(ws - 200, Math.round(p.x))),
        y: Math.max(200, Math.min(ws - 200, Math.round(p.y))),
        vault: 0, armory: {}, hangar: [], reserves: [], board: []
      };
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('🏠 Home Base established in ' + SF.SYSTEM_BY_ID[SF.Game.systemId].name);
      return true;
    },

    /* refresh the mission board when docked at home (3 offers, never empty) */
    refreshBoard: function () {
      var h = hb();
      if (!h) return;
      if (!h.board || h.board.length === 0) {
        h.board = [rollMission(), rollMission(), rollMission()];
      }
    },

    acceptMission: function (missionId) {
      var h = hb();
      if (!h) return false;
      var i = (h.board || []).findIndex(function (m) { return m.id === missionId; });
      if (i < 0) return false;
      var m = h.board.splice(i, 1)[0];
      SF.Game.waypoint = { systemId: m.systemId, x: m.x, y: m.y, label: m.text, mission: m };
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Waypoint set — fly to it, captain.');
      return true;
    },

    clearWaypoint: function () {
      SF.Game.waypoint = null;
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Waypoint cleared.');
    },

    /* called each tick while PLAYING: complete a mission on arrival */
    checkArrival: function () {
      // trade-contracts: expire overdue contracts while flying
      if (window.SF && SF.Contracts) SF.Contracts.tick();
      var wp = SF.Game.waypoint;
      if (!wp || !wp.mission) return;
      if (wp.systemId !== SF.Game.systemId) return;
      var dx = SF.Player.x - wp.x, dy = SF.Player.y - wp.y;
      if (dx * dx + dy * dy < 320 * 320) {
        SF.Player.credits += wp.mission.reward;
        if (SF.Audio && SF.Audio.buy) SF.Audio.buy();
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('✔ ' + wp.mission.text.split(' reported')[0] + ' — +' + fmt(wp.mission.reward) + 'c');
        SF.Game.waypoint = null;
      }
    },

    /* ---- vault / armory / hangar / reserves ---- */
    vaultDeposit: function (n) {
      var h = hb(), p = SF.Player;
      if (!h || p.credits < n || n <= 0) return false;
      p.credits -= n; h.vault += n; return true;
    },
    vaultWithdraw: function (n) {
      var h = hb(), p = SF.Player;
      if (!h || h.vault < n || n <= 0) return false;
      h.vault -= n; p.credits += n; return true;
    },
    armoryDeposit: function (partId) {
      var h = hb(), p = SF.Player;
      if (!h || (p.partInventory[partId] || 0) <= 0) return false;
      p.partInventory[partId]--; h.armory[partId] = (h.armory[partId] || 0) + 1;
      return true;
    },
    armoryWithdraw: function (partId) {
      var h = hb(), p = SF.Player;
      if (!h || (h.armory[partId] || 0) <= 0) return false;
      h.armory[partId]--; p.addPart(partId, 1);
      return true;
    },
    parkShip: function (shipIdx) {
      var h = hb(), p = SF.Player;
      if (!h || h.hangar.length >= HANGAR_CAP) return false;
      if (shipIdx === p.activeShip) return false;
      if (shipIdx < 0 || shipIdx >= p.ships.length) return false;
      h.hangar.push(p.ships.splice(shipIdx, 1)[0]);
      return true;
    },
    unparkShip: function (hangarIdx) {
      var h = hb(), p = SF.Player;
      if (!h || hangarIdx < 0 || hangarIdx >= h.hangar.length) return false;
      p.ships.push(h.hangar.splice(hangarIdx, 1)[0]);
      return true;
    },
    reserveCompanion: function (id) {
      // move a hired wingman into reserves (bench from active wing first)
      var h = hb();
      if (!h || !SF.Companions || !SF.Companions.isHired(id)) return false;
      var act = SF.Companions.active();
      for (var i = act.length - 1; i >= 0; i--) if (act[i].id === id) act.splice(i, 1);
      var hired = SF.Companions.hired();
      var j = hired.indexOf(id);
      if (j >= 0) hired.splice(j, 1);
      if (h.reserves.indexOf(id) < 0) h.reserves.push(id);
      return true;
    },
    recallCompanion: function (id) {
      var h = hb();
      if (!h || !SF.Companions) return false;
      var j = h.reserves.indexOf(id);
      if (j < 0) return false;
      h.reserves.splice(j, 1);
      SF.Companions.hired().push(id);
      return true;
    },

    /* ---- station UI ---- */
    renderPurchase: function (body) {
      var div = document.createElement('div');
      div.className = 'store-row';
      div.innerHTML = '<div class="store-info"><div>' +
        '<div class="store-name">🏠 Buy Personal Station — 25,000c</div>' +
        '<div class="store-desc">Your own station in this system: hangar (8 ships), armory, vault, ' +
        'companion reserves, mission board with waypoints.</div></div></div>';
      var b = document.createElement('button');
      b.className = 'btn store-btn';
      b.textContent = 'BUY · 25,000c';
      if (SF.Player.credits < HB_COST) b.disabled = true;
      b.addEventListener('click', function () {
        if (this.buy()) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
        else SF.Audio.deny();
      }.bind(this));
      div.appendChild(b);
      body.appendChild(div);
    },

    renderPanel: function (body) {
      var h = hb();
      if (!h) return;
      var head = document.createElement('div');
      head.className = 'store-head';
      head.textContent = '🏠 HOME BASE — ' + SF.SYSTEM_BY_ID[h.systemId].name.toUpperCase();
      body.appendChild(head);
      var self = this, p = SF.Player;

      function row(name, desc, btnLabel, enabled, onClick, tier) {
        var div = document.createElement('div');
        div.className = 'store-row';
        var dot = tier ? '<span class="tier-dot" style="background:' + SF.TIERS[tier] + '"></span>' : '';
        div.innerHTML = '<div class="store-info">' + dot + '<div><div class="store-name">' +
          name + '</div><div class="store-desc">' + desc + '</div></div></div>';
        var b = document.createElement('button');
        b.className = 'btn store-btn';
        b.textContent = btnLabel;
        if (!enabled) b.disabled = true;
        b.addEventListener('click', function () { onClick(); });
        div.appendChild(b);
        body.appendChild(div);
      }

      // vault
      row('Vault — ' + fmt(h.vault) + 'c', 'Your credits: ' + fmt(p.credits) + 'c',
        'DEPOSIT 1,000c', p.credits >= 1000, function () {
          if (self.vaultDeposit(1000)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
        });
      if (h.vault > 0) {
        row('Vault — ' + fmt(h.vault) + 'c', 'Stored safely. No fees, no thieves.',
          'WITHDRAW 1,000c', true, function () {
            if (self.vaultWithdraw(1000)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          });
      }

      // armory
      var arm = document.createElement('div');
      arm.className = 'store-desc';
      arm.style.cssText = 'margin:8px 0 2px;letter-spacing:2px;';
      arm.textContent = '— ARMORY —';
      body.appendChild(arm);
      var armKeys = Object.keys(h.armory).filter(function (k) { return h.armory[k] > 0; });
      armKeys.forEach(function (id) {
        var pt = SF.PART_BY_ID[id];
        row((pt ? pt.name : id) + ' ×' + h.armory[id], 'Stored in the armory.',
          'WITHDRAW', true, function () {
            if (self.armoryWithdraw(id)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          }, pt ? pt.tier : null);
      });
      var invKeys = Object.keys(p.partInventory || {}).filter(function (k) { return p.partInventory[k] > 0; });
      if (invKeys.length) {
        var dep = document.createElement('div');
        dep.className = 'dim';
        dep.textContent = 'Deposit spare parts:';
        body.appendChild(dep);
        invKeys.forEach(function (id) {
          var pt = SF.PART_BY_ID[id];
          row((pt ? pt.name : id) + ' ×' + p.partInventory[id], 'In your part inventory.',
            'DEPOSIT', true, function () {
              if (self.armoryDeposit(id)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
            }, pt ? pt.tier : null);
        });
      }
      if (!armKeys.length && !invKeys.length) {
        var an = document.createElement('div');
        an.className = 'dim';
        an.textContent = 'Armory empty. Deposit spare parts here.';
        body.appendChild(an);
      }

      // hangar
      var hg = document.createElement('div');
      hg.className = 'store-desc';
      hg.style.cssText = 'margin:8px 0 2px;letter-spacing:2px;';
      hg.textContent = '— HANGAR (' + h.hangar.length + '/' + HANGAR_CAP + ') —';
      body.appendChild(hg);
      h.hangar.forEach(function (sh, i) {
        var cls = SF.SHIP_CLASS_BY_ID[sh.classId];
        row(sh.name + ' — ' + (cls ? cls.name : sh.classId), 'Parked at Home Base.',
          'UNPARK', true, function () {
            if (self.unparkShip(i)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          });
      });
      p.ships.forEach(function (sh, i) {
        if (i === p.activeShip) return;
        var cls = SF.SHIP_CLASS_BY_ID[sh.classId];
        row(sh.name + ' — ' + (cls ? cls.name : sh.classId), 'Your ship, currently with you.',
          h.hangar.length >= HANGAR_CAP ? 'HANGAR FULL' : 'PARK',
          h.hangar.length < HANGAR_CAP, function () {
            if (self.parkShip(i)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          });
      });

      // companion reserves
      var cr = document.createElement('div');
      cr.className = 'store-desc';
      cr.style.cssText = 'margin:8px 0 2px;letter-spacing:2px;';
      cr.textContent = '— COMPANION RESERVES —';
      body.appendChild(cr);
      (h.reserves || []).forEach(function (id) {
        var def = compDef(id);
        row((def ? def.name : id) + ' (reserves)', 'Resting at Home Base.',
          'RECALL', true, function () {
            if (self.recallCompanion(id)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          });
      });
      if (SF.Companions) {
        SF.Companions.hired().forEach(function (id) {
          var def = compDef(id);
          row((def ? def.name : id) + ' (with you)', 'Bench to the reserves.',
            'RESERVE', true, function () {
              if (self.reserveCompanion(id)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
            });
        });
      }
      if (!h.reserves.length && (!SF.Companions || !SF.Companions.hired().length)) {
        var cn = document.createElement('div');
        cn.className = 'dim';
        cn.textContent = 'No companions yet. Hire wingmen at stations.';
        body.appendChild(cn);
      }

      // mission board
      var mb = document.createElement('div');
      mb.className = 'store-desc';
      mb.style.cssText = 'margin:8px 0 2px;letter-spacing:2px;';
      mb.textContent = '— MISSION BOARD —';
      body.appendChild(mb);
      (h.board || []).forEach(function (m) {
        row('[' + m.kind.toUpperCase() + '] +' + fmt(m.reward) + 'c',
          m.text + ' Waypoint: ' + SF.SYSTEM_BY_ID[m.systemId].name + ' (' + m.x + ', ' + m.y + ')',
          'SET WAYPOINT', true, function () {
            if (self.acceptMission(m.id)) { SF.Audio.buy(); SF.Save.save(); SF.Station.renderStore(); }
          });
      });
      if (SF.Game.waypoint && SF.Game.waypoint.mission) {
        row('Active waypoint', SF.Game.waypoint.label,
          'CLEAR', true, function () {
            self.clearWaypoint(); SF.Save.save(); SF.Station.renderStore();
          });
      }
    }
  };

  SF.Homebase = Homebase;
})();

/* ============================================================
 * trade-intel phase: SF.TradeIntel — market intel scanner + route advisor.
 *
 * (1) Intel scanner: a 50c ping at any station market reveals the next 3
 * price ticks per good at the current station (trend direction + magnitude).
 * The forecast is EXACT: runScan() pre-rolls the ticks with the same drift
 * formula Trading.drift() uses and queues them on the markets blob; drift()
 * consumes one queued tick per dock instead of rolling fresh.
 *
 * (2) Trade-route advisor: a ROUTES tab in the market UI lists the best
 * known routes from visited stations' recorded prices (last-seen buy/sell
 * per good per station, recorded on every market render).
 *
 * Additive on SF.Trading — the market list rendering is wrapped, not
 * rewritten; drift() gained one guarded branch. Save-neutral: the _intel
 * blob rides on SF.Player.markets (serialized since save v5), so
 * SF.SAVE_VERSION is NOT bumped. Every read is defensive against
 * old/partial blobs.
 * ============================================================ */

SF.CONFIG.tradeIntel = SF.CONFIG.tradeIntel || {
  scanCost: 50,      // credits per ping
  forecastTicks: 3,  // ticks revealed per scan
  maxRoutes: 8       // routes listed in the advisor tab
};

(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function icfg() { return SF.CONFIG.tradeIntel; }
  function tcfg() { return SF.CONFIG.trading; }

  function goodsList() { return (tcfg() && tcfg().goods) || []; }
  function goodById(gid) {
    var gs = goodsList();
    for (var i = 0; i < gs.length; i++) if (gs[i].id === gid) return gs[i];
    return null;
  }

  function stKeyOf(st) {
    return SF.Game.systemId + ':' + (st && st.name ? st.name : (SF.Game.dockedAt || ''));
  }

  /* Defensive _intel blob on the existing markets object (save-neutral). */
  function blob() {
    var p = SF.Player;
    if (!p.markets || typeof p.markets !== 'object' || Array.isArray(p.markets)) p.markets = {};
    var b = p.markets._intel;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      b = { scans: {}, memory: {} };
      p.markets._intel = b;
    }
    if (!b.scans || typeof b.scans !== 'object' || Array.isArray(b.scans)) b.scans = {};
    if (!b.memory || typeof b.memory !== 'object' || Array.isArray(b.memory)) b.memory = {};
    return b;
  }

  /* Current per-good multipliers for a station (defensive: drift() on dock
   * normally guarantees the market exists). */
  function currentMults(st) {
    var mk = (SF.Player.markets || {})[stKeyOf(st)] || {};
    var out = {};
    goodsList().forEach(function (g) {
      var e = mk[g.id];
      out[g.id] = (e && typeof e.m === 'number') ? e.m : 1;
    });
    return out;
  }

  /* Standing-discount mirror (the private systemFaction() in the Trading
   * IIFE is out of reach here; CONFIG + SF.Factions are public). */
  function standingGood() {
    var c = tcfg();
    var fid = (c.systemFaction || {})[SF.Game.systemId];
    var s = (window.SF && SF.Factions && fid) ? SF.Factions.standing(fid) : 0;
    return s >= c.standingNeed;
  }

  /* Price of a good at a hypothetical multiplier (mirrors Trading.price). */
  function priceAt(gid, m, side) {
    var g = goodById(gid), c = tcfg();
    if (!g || !c) return 0;
    var sysMul = ((c.systemMul || {})[SF.Game.systemId] || {})[gid] || 1;
    var base = g.base * sysMul * m;
    var disc = standingGood();
    if (side === 'buy') return Math.max(1, Math.ceil(base * (disc ? c.standingCut : 1)));
    return Math.max(1, Math.floor(base * c.sellSpread * (disc ? c.standingBonus : 1)));
  }

  /* One future tick, using the exact drift formula drift() uses. */
  function simTick(cur) {
    var c = tcfg(), out = {};
    Object.keys(cur).forEach(function (gid) {
      var m = cur[gid] * (1 + (Math.random() * 2 - 1) * c.driftPct);
      out[gid] = Math.round(clamp(m, c.driftMin, c.driftMax) * 1000) / 1000;
    });
    return out;
  }

  var TradeIntel = {

    _tab: 'market', // 'market' | 'routes' — UI-only, never saved

    /* ---- price memory: last-seen buy/sell per good per station ---- */
    recordPrices: function (st) {
      if (!window.SF || !SF.Trading) return;
      var b = blob(), key = stKeyOf(st);
      var mem = b.memory[key];
      if (!mem || typeof mem !== 'object' || Array.isArray(mem)) {
        mem = {};
        b.memory[key] = mem;
      }
      goodsList().forEach(function (g) {
        try {
          mem[g.id] = {
            buy: SF.Trading.price(st, g.id, 'buy'),
            sell: SF.Trading.price(st, g.id, 'sell'),
            at: Date.now()
          };
        } catch (e) { /* market not initialized — skip this good */ }
      });
    },

    memory: function () { return blob().memory; },

    memoryFor: function (key) {
      var m = blob().memory[key];
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    },

    /* ---- intel scanner ---- */
    scanCost: function () { return icfg().scanCost; },

    /* Remaining queued forecast ticks for a station (oldest first). */
    queued: function (st) {
      var sc = blob().scans[stKeyOf(st)];
      if (!sc || !Array.isArray(sc.queued)) return [];
      return sc.queued.filter(function (t) { return t && typeof t === 'object'; });
    },

    /* 50c ping: pre-roll the next N ticks from the CURRENT multipliers and
     * queue them. drift() consumes them one per dock, so the forecast is
     * exactly what the market will do. */
    runScan: function (st) {
      var p = SF.Player, cfg = icfg();
      if (p.credits < cfg.scanCost) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Intel scan needs ' + cfg.scanCost + 'c.');
        if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
        return false;
      }
      p.credits -= cfg.scanCost;
      var cur = currentMults(st), ticks = [];
      for (var i = 0; i < cfg.forecastTicks; i++) { cur = simTick(cur); ticks.push(cur); }
      blob().scans[stKeyOf(st)] = { queued: ticks, at: Date.now() };
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('📡 Scan complete — next ' + ticks.length + ' ticks revealed.');
      if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
      if (SF.Audio && SF.Audio.sfx) SF.Audio.sfx('intel_scan');
      return true;
    },

    /* Consumed by Trading.drift(): one queued tick per dock. */
    takeTick: function (st) {
      var sc = blob().scans[stKeyOf(st)];
      if (!sc || !Array.isArray(sc.queued) || !sc.queued.length) return null;
      var t = sc.queued.shift();
      return (t && typeof t === 'object') ? t : null;
    },

    /* ---- route advisor ---- */
    stationLabel: function (key) {
      var i = key.indexOf(':');
      var sys = i < 0 ? '' : key.slice(0, i);
      var name = i < 0 ? key : key.slice(i + 1);
      var sysName = (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[sys]) ?
        SF.SYSTEM_BY_ID[sys].name : sys;
      return name + ' (' + sysName + ')';
    },

    /* Best known buy-low/sell-high routes across all remembered stations,
     * sorted by profit per ton, capped at maxRoutes. */
    bestRoutes: function () {
      var mem = blob().memory;
      var keys = Object.keys(mem).filter(function (k) {
        return mem[k] && typeof mem[k] === 'object' && !Array.isArray(mem[k]);
      });
      var routes = [];
      for (var a = 0; a < keys.length; a++) {
        for (var b = 0; b < keys.length; b++) {
          if (a === b) continue;
          var ma = mem[keys[a]], mb = mem[keys[b]];
          goodsList().forEach(function (g) {
            var pa = ma && ma[g.id], pb = mb && mb[g.id];
            if (!pa || !pb || typeof pa.buy !== 'number' || typeof pb.sell !== 'number') return;
            var profit = pb.sell - pa.buy;
            if (profit <= 0) return;
            routes.push({
              goodId: g.id, goodName: g.name,
              buyKey: keys[a], sellKey: keys[b],
              buy: pa.buy, sell: pb.sell, profit: profit,
              margin: pa.buy > 0 ? Math.round(profit / pa.buy * 100) : 0
            });
          });
        }
      }
      routes.sort(function (x, y) { return y.profit - x.profit; });
      return routes.slice(0, icfg().maxRoutes);
    },

    /* ---- market UI: tab shell + scanner + advisor ---- */
    ensureCSS: function () {
      if (document.getElementById('trade-intel-css')) return;
      var css = [
        '.intel-tabs{display:flex;gap:6px;margin:8px 0}',
        '.intel-tab.active{border-color:#39d5e8;color:#39d5e8}',
        '.intel-scan{border:1px solid #2a3a5f;border-radius:8px;padding:8px;margin-bottom:8px;background:rgba(10,16,32,.6)}',
        '.intel-scan-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}',
        '.intel-tick{display:flex;justify-content:space-between;font-size:12px;color:#9fb3d9;padding:2px 0;border-top:1px dotted #22314f}',
        '.intel-up{color:#3ddc5f}', '.intel-down{color:#ff5e3a}', '.intel-flat{color:#9fb3d9}',
        '.intel-route-tag{font-size:11px;padding:1px 6px;border:1px solid #39d5e8;border-radius:10px;color:#39d5e8;margin-left:6px;white-space:nowrap}'
      ].join('\n');
      var el = document.createElement('style');
      el.id = 'trade-intel-css';
      el.textContent = css;
      document.head.appendChild(el);
    },

    renderTabs: function (body, st) {
      var self = this;
      var tabs = document.createElement('div');
      tabs.className = 'intel-tabs';
      tabs.id = 'intel-tabs';
      [['market', '📦 MARKET'], ['routes', '🧭 ROUTES']].forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'btn small intel-tab' + (self._tab === t[0] ? ' active' : '');
        b.textContent = t[1];
        b.setAttribute('data-intel-tab', t[0]);
        b.addEventListener('click', function () {
          self._tab = t[0];
          if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
          SF.Station.renderStore();
        });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
    },

    renderScanner: function (body, st) {
      var self = this, cfg = icfg();
      var wrap = document.createElement('div');
      wrap.className = 'intel-scan';
      wrap.id = 'intel-scanner';

      var head = document.createElement('div');
      head.className = 'intel-scan-head';
      var txt = document.createElement('div');
      /* Exactness note: Trading.drift() runs on dock at dock/homebase
       * stations (station.js), consuming one queued tick per visit — the
       * forecast matches reality there. HQ/planet markets don't drift on
       * dock (pre-existing station.js behavior, outside this phase's file
       * scope), so a scan there shows projected movement. */
      var driftsHere = st && (st.kind === 'dock' || st.kind === 'homebase');
      txt.innerHTML = '<b>📡 INTEL SCANNER</b><div class="dim" style="font-size:12px">' +
        'Ping the market: reveals the next ' + cfg.forecastTicks + ' price ticks here. ' +
        (driftsHere ? 'Forecasts are exact — the market follows them.'
                    : 'Local markets are static between visits — showing projected movement.') +
        '</div>';
      head.appendChild(txt);
      var btn = document.createElement('button');
      btn.className = 'btn small';
      btn.id = 'intel-scan-btn';
      btn.textContent = 'PING — ' + cfg.scanCost + 'c';
      if (SF.Player.credits < cfg.scanCost) { btn.disabled = true; btn.title = 'Not enough credits'; }
      btn.addEventListener('click', function () {
        if (self.runScan(st)) { SF.Save.save(); SF.Station.renderStore(); }
      });
      head.appendChild(btn);
      wrap.appendChild(head);

      var queued = this.queued(st);
      if (queued.length) {
        var prevM = currentMults(st);
        queued.forEach(function (tick, ti) {
          goodsList().forEach(function (g) {
            var m = tick[g.id];
            if (typeof m !== 'number') return;
            var p0 = priceAt(g.id, prevM[g.id], 'buy');
            var p1 = priceAt(g.id, m, 'buy');
            var d = p1 - p0;
            var cls = d > 0 ? 'intel-up' : (d < 0 ? 'intel-down' : 'intel-flat');
            var arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '–');
            var row = document.createElement('div');
            row.className = 'intel-tick';
            row.setAttribute('data-tick', String(ti + 1));
            row.setAttribute('data-good', g.id);
            row.innerHTML = '<span>T+' + (ti + 1) + ' ' + g.name + '</span>' +
              '<span class="' + cls + '">' + fmt(p1) + 'c ' + arrow +
              (d !== 0 ? ' ' + (d > 0 ? '+' : '−') + fmt(Math.abs(d)) + 'c' : '') + '</span>';
            wrap.appendChild(row);
          });
          prevM = tick;
        });
      } else {
        var none = document.createElement('div');
        none.className = 'dim';
        none.style.fontSize = '12px';
        none.textContent = 'No active forecast. Run a ping to see where prices are headed.';
        wrap.appendChild(none);
      }
      body.appendChild(wrap);
    },

    renderRoutes: function (body, st) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '🧭 ROUTE ADVISOR';
      body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '4px';
      note.textContent = 'Best known hauls from prices seen at visited stations. ' +
        'Dock somewhere new to sharpen the intel.';
      body.appendChild(note);

      var routes = this.bestRoutes();
      var hereKey = stKeyOf(st);
      var hold = SF.Player.goods || {};
      var stationCount = Object.keys(blob().memory).length;
      if (!routes.length) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.id = 'intel-routes-empty';
        none.textContent = stationCount < 2
          ? 'Not enough price intel yet — visit at least two station markets.'
          : 'Markets are flat across known stations — no profitable hauls right now. ' +
            'Prices move every visit; check back later.';
        body.appendChild(none);
        return;
      }
      var self = this;
      routes.forEach(function (r, i) {
        var div = document.createElement('div');
        div.className = 'store-row intel-route';
        div.setAttribute('data-good', r.goodId);
        div.setAttribute('data-buy-key', r.buyKey);
        div.setAttribute('data-sell-key', r.sellKey);
        var tags = '';
        if (r.buyKey === hereKey) tags += '<span class="intel-route-tag">BUY HERE</span>';
        if ((hold[r.goodId] || 0) > 0)
          tags += '<span class="intel-route-tag">' + hold[r.goodId] + 't ABOARD</span>';
        div.innerHTML = '<div class="store-info"><div>' +
          '<div class="store-name">#' + (i + 1) + ' ' + r.goodName + tags + '</div>' +
          '<div class="store-desc">Buy @ ' + self.stationLabel(r.buyKey) + ' ' + fmt(r.buy) + 'c/t → ' +
          'Sell @ ' + self.stationLabel(r.sellKey) + ' ' + fmt(r.sell) + 'c/t — ' +
          '<b style="color:#3ddc5f">+' + fmt(r.profit) + 'c/t (+' + r.margin + '%)</b></div>' +
          '</div></div>';
        body.appendChild(div);
      });
    }
  };

  SF.TradeIntel = TradeIntel;

  /* Wrap (never rewrite) the market UI: record price memory on every render,
   * draw the tab shell, then render either the scanner + original market
   * list or the route advisor. */
  (function () {
    var origRenderMarket = SF.Trading.renderMarket;
    SF.Trading.renderMarket = function (body, st) {
      SF.TradeIntel.ensureCSS();
      SF.TradeIntel.recordPrices(st);
      SF.TradeIntel.renderTabs(body, st);
      if (SF.TradeIntel._tab === 'routes') {
        SF.TradeIntel.renderRoutes(body, st);
      } else {
        SF.TradeIntel.renderScanner(body, st);
        origRenderMarket.call(SF.Trading, body, st);
      }
    };
  })();
})();

/* ============================================================
 * trade-route-planner phase (2026-10-20, retry)
 * Adds to SF.TradeIntel (additive only; runtime + UI state, save-neutral):
 *   - 'planner' tab in the market UI: ROUTE PLANNER
 *   - planRoutes(st): top-3 profitable routes for the CURRENT cargo hold,
 *     priced with LIVE per-system price multipliers + news-event modifiers
 *     (SF.Events trade_boom, read-only), showing profit/ton and travel dist
 *   - pinRoute(route): one-tap 'set route' -> SF.NavMarks waypoint pin
 *     (read-only use of SF.NavMarks / SF.Station / SF.Events)
 * Save-neutral: pinned route lives in module/UI state only. No SAVE_VERSION
 * bump. No edits to any other file.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function tcfg() { return SF.CONFIG.trading; }
  function goodsList() { return (tcfg() && tcfg().goods) || []; }

  /* star-map layout anchors (mirror of the starmap % layout), 1% = 2.5 ly */
  var SYS_POS = { solace: [22, 55], drift: [52, 30], ember: [78, 62] };

  function distLy(a, b) {
    var pa = SYS_POS[a], pb = SYS_POS[b];
    if (!pa || !pb) return 0;
    return Math.round(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * 2.5 * 10) / 10;
  }

  /* read-only: trade_boom sell multiplier for a system (1 when no boom) */
  function boomSellMulFor(sysId) {
    try {
      if (!window.SF || !SF.Events || typeof SF.Events.active !== 'function') return 1;
      var act = SF.Events.active();
      for (var i = 0; i < act.length; i++) {
        if (act[i] && act[i].type === 'trade_boom' && act[i].systemId === sysId) {
          var cfg = (typeof SF.Events.config === 'function') ? SF.Events.config() : null;
          return (cfg && typeof cfg.boomSellMul === 'number') ? cfg.boomSellMul : 1.25;
        }
      }
    } catch (e) { /* news system absent — treat as no boom */ }
    return 1;
  }

  /* standing-good mirror for an arbitrary system (not just the current one) */
  function standingGoodAt(sysId) {
    var c = tcfg();
    var fid = (c.systemFaction || {})[sysId];
    var s = (window.SF && SF.Factions && fid) ? SF.Factions.standing(fid) : 0;
    return s >= c.standingNeed;
  }

  /* Live sell price of a good at a known (remembered) station.
   * Mirrors Trading.price sell-side with the destination systemMul, the
   * destination market's CURRENT multiplier, the destination standing
   * bonus, and the news-event boom modifier (all read-only). */
  function sellAt(sysId, destKey, gid) {
    var gs = goodsList(), g = null, c = tcfg();
    if (!c) return { price: 0, boom: false };
    for (var i = 0; i < gs.length; i++) if (gs[i].id === gid) g = gs[i];
    if (!g) return { price: 0, boom: false };
    var sysMul = ((c.systemMul || {})[sysId] || {})[gid] || 1;
    var mk = (SF.Player && SF.Player.markets && SF.Player.markets[destKey]) || {};
    var m = (mk[gid] && typeof mk[gid].m === 'number') ? mk[gid].m : 1;
    var boom = boomSellMulFor(sysId);
    var base = g.base * sysMul * m;
    var price = Math.max(1, Math.floor(base * c.sellSpread *
      (standingGoodAt(sysId) ? c.standingBonus : 1) * boom));
    return { price: price, boom: boom > 1 };
  }

  /* Destination world coords for the waypoint pin (read-only SF.Station). */
  function destCoords(sysId, name) {
    try {
      if (window.SF && SF.Station && typeof SF.Station.allStations === 'function') {
        var list = SF.Station.allStations(sysId) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].name === name && typeof list[i].x === 'number') {
            return { x: list[i].x, y: list[i].y };
          }
        }
        if (list.length && typeof list[0].x === 'number') return { x: list[0].x, y: list[0].y };
      }
    } catch (e) { /* station list unavailable */ }
    return null;
  }

  function keySys(key) { var i = key.indexOf(':'); return i < 0 ? '' : key.slice(0, i); }
  function keyName(key) { var i = key.indexOf(':'); return i < 0 ? key : key.slice(i + 1); }

  var Planner = {

    _pinnedKey: null, // sellKey of the pinned route; UI-only, never saved

    /* Top-3 routes for what's actually in the hold right now. Candidate
     * legs: buy HERE (exact live buy price) -> sell at a remembered station.
     * Ranked by total hold profit (profit/ton x tons aboard). */
    planRoutes: function (st) {
      var hereSys = SF.Game.systemId;
      var hereKey = hereSys + ':' + (st && st.name ? st.name : (SF.Game.dockedAt || ''));
      var hold = (SF.Player && SF.Player.goods) || {};
      var mem = (window.SF && SF.TradeIntel && typeof SF.TradeIntel.memory === 'function') ?
        SF.TradeIntel.memory() : {};
      var destKeys = Object.keys(mem).filter(function (k) {
        return k !== hereKey && mem[k] && typeof mem[k] === 'object' && !Array.isArray(mem[k]);
      });
      var routes = [];
      goodsList().forEach(function (g) {
        var tons = hold[g.id] || 0;
        if (!(tons > 0)) return;
        var buyHere;
        try { buyHere = SF.Trading.price(st, g.id, 'buy'); } catch (e) { return; }
        destKeys.forEach(function (dk) {
          var sysId = keySys(dk);
          if (!sysId) return;
          var s = sellAt(sysId, dk, g.id);
          var profit = s.price - buyHere;
          if (profit <= 0) return;
          var xy = destCoords(sysId, keyName(dk));
          routes.push({
            goodId: g.id, goodName: g.name,
            buyKey: hereKey, sellKey: dk,
            sysId: sysId, stName: keyName(dk),
            buy: buyHere, sell: s.price, profit: profit,
            margin: buyHere > 0 ? Math.round(profit / buyHere * 100) : 0,
            tons: tons, total: profit * tons,
            distLy: distLy(hereSys, sysId),
            boom: s.boom,
            destX: xy ? xy.x : null, destY: xy ? xy.y : null
          });
        });
      });
      routes.sort(function (a, b) { return (b.total - a.total) || (b.profit - a.profit); });
      return routes.slice(0, 3);
    },

    pinnedKey: function () { return this._pinnedKey; },

    /* One-tap 'set route': pin the destination as the star-map waypoint.
     * Uses the existing SF.NavMarks hook; trading.js stays the only file
     * touched. Returns false when the hook is unreachable. */
    pinRoute: function (route) {
      if (!route || route.destX === null ||
          !(window.SF && SF.NavMarks && typeof SF.NavMarks.set === 'function')) return false;
      SF.NavMarks.set(route.sysId, route.destX, route.destY);
      this._pinnedKey = route.sellKey;
      try {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('🗺 Route pinned: ' + route.goodName + ' → ' + route.stName);
        if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
        /* voice-wiring-v6: pack-6 route-set line, guarded, save-neutral */
        if (window.SF && SF.Voice6 && SF.Voice6.pick) SF.Voice6.pick('route_set', 3);
      } catch (e) { /* toast/audio optional */ }
      return true;
    },

    unpinRoute: function () {
      this._pinnedKey = null;
      try {
        if (window.SF && SF.NavMarks && typeof SF.NavMarks.clear === 'function') SF.NavMarks.clear();
      } catch (e) { /* optional */ }
    },

    /* test/sim helpers */
    distLy: distLy,
    boomSellMulFor: boomSellMulFor,
    sellAt: sellAt
  };

  /* Merge into SF.TradeIntel and extend its market UI — all additive. */
  function install() {
    var TI = window.SF && SF.TradeIntel;
    if (!TI || TI._plannerInstalled) return;
    TI._plannerInstalled = true;
    TI.planRoutes = Planner.planRoutes;
    TI.pinRoute = Planner.pinRoute;
    TI.unpinRoute = Planner.unpinRoute;
    TI.pinnedKey = Planner.pinnedKey;
    TI.distLy = distLy;
    TI.boomSellMulFor = boomSellMulFor;
    TI.sellAt = sellAt;

    if (!document.getElementById('trade-planner-css')) {
      var css = [
        '.planner-route{border:1px solid #2a3a5f;border-radius:8px;padding:8px;margin-bottom:8px;background:rgba(10,16,32,.6)}',
        '.planner-route-head{display:flex;justify-content:space-between;align-items:center;gap:8px}',
        '.planner-stats{font-size:12px;color:#9fb3d9;margin:4px 0}',
        '.planner-profit{color:#3ddc5f;font-weight:bold}',
        '.boom-tag{font-size:11px;padding:1px 6px;border:1px solid #ff9f2e;border-radius:10px;color:#ff9f2e;margin-left:6px;white-space:nowrap}',
        '.pinned-tag{font-size:11px;padding:1px 6px;border:1px solid #3ddc5f;border-radius:10px;color:#3ddc5f;margin-left:6px;white-space:nowrap}'
      ].join('\n');
      var el = document.createElement('style');
      el.id = 'trade-planner-css';
      el.textContent = css;
      document.head.appendChild(el);
    }

    /* third tab on the intel tab shell */
    var origTabs = TI.renderTabs;
    TI.renderTabs = function (body, st) {
      origTabs.call(TI, body, st);
      var tabs = document.getElementById('intel-tabs');
      if (!tabs) return;
      if (!tabs.querySelector('[data-intel-tab="planner"]')) {
        var b = document.createElement('button');
        b.className = 'btn small intel-tab' + (TI._tab === 'planner' ? ' active' : '');
        b.textContent = '🗺 PLANNER';
        b.setAttribute('data-intel-tab', 'planner');
        b.addEventListener('click', function () {
          TI._tab = 'planner';
          if (SF.Audio && SF.Audio.ui) SF.Audio.ui();
          SF.Station.renderStore();
        });
        tabs.appendChild(b);
      }
      /* keep the active highlight correct across re-renders */
      var btns = tabs.querySelectorAll('.intel-tab');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-intel-tab') === TI._tab);
      }
    };

    TI.renderPlanner = function (body, st) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.id = 'planner-head';
      h.textContent = '🗺 ROUTE PLANNER';
      body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '4px';
      note.textContent = 'Live prices + news modifiers, ranked for what is in your hold right now. ' +
        'Set route pins the destination as your star-map waypoint.';
      body.appendChild(note);

      var hold = (SF.Player && SF.Player.goods) || {};
      var holdTons = Object.keys(hold).reduce(function (n, k) { return n + (hold[k] || 0); }, 0);
      if (!(holdTons > 0)) {
        var empty = document.createElement('div');
        empty.className = 'dim';
        empty.id = 'planner-empty';
        empty.textContent = 'Your hold is empty — buy goods here and the planner will rank where to sell them.';
        body.appendChild(empty);
        return;
      }

      var routes = TI.planRoutes(st);
      if (!routes.length) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.id = 'planner-none';
        none.textContent = 'No profitable legs from this station with your current hold. Try a different market.';
        body.appendChild(none);
        return;
      }

      routes.forEach(function (r, i) {
        var div = document.createElement('div');
        div.className = 'planner-route';
        div.setAttribute('data-route', String(i));
        div.setAttribute('data-good', r.goodId);
        div.setAttribute('data-sell-key', r.sellKey);
        var tags = '';
        if (r.boom) tags += '<span class="boom-tag">🔥 BOOM +' +
          Math.round((TI.boomSellMulFor(r.sysId) - 1) * 100) + '%</span>';
        tags += '<span class="intel-route-tag">' + r.tons + 't ABOARD</span>';
        var isPinned = TI.pinnedKey() === r.sellKey;
        if (isPinned) tags += '<span class="pinned-tag">✓ PINNED</span>';
        var head = document.createElement('div');
        head.className = 'planner-route-head';
        head.innerHTML = '<div><div class="store-name">#' + (i + 1) + ' ' + r.goodName + tags + '</div>' +
          '<div class="store-desc">Buy here ' + r.buy + 'c/t → Sell @ ' +
          TI.stationLabel(r.sellKey) + ' ' + r.sell + 'c/t</div></div>';
        var btn = document.createElement('button');
        btn.className = 'btn small planner-pin';
        btn.setAttribute('data-pin', r.sellKey);
        btn.textContent = isPinned ? '✓ PINNED' : 'SET ROUTE';
        btn.addEventListener('click', function () {
          if (TI.pinnedKey() === r.sellKey) { TI.unpinRoute(); }
          else { TI.pinRoute(r); }
          SF.Station.renderStore();
        });
        head.appendChild(btn);
        div.appendChild(head);
        var stats = document.createElement('div');
        stats.className = 'planner-stats';
        stats.innerHTML = '<span class="planner-profit">+' + r.profit + 'c/t (+' + r.margin + '%)</span>' +
          ' • ' + r.tons + 't aboard = <b>+' + r.total + 'c</b> • ≈' + r.distLy + ' ly';
        div.appendChild(stats);
        body.appendChild(div);
      });
    };

    /* route the market wrapper to the planner tab */
    var origMarket = SF.Trading.renderMarket;
    SF.Trading.renderMarket = function (body, st) {
      if (TI._tab === 'planner') {
        TI.ensureCSS();
        TI.renderTabs(body, st);
        TI.renderPlanner(body, st);
        return;
      }
      origMarket.call(SF.Trading, body, st);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();

/* ============================================================
 * trading-dynamics phase (2026-10-20): SF.TradeDynamics — the
 * economy gets a pulse. Additive on SF.Trading; nothing existing
 * is refactored, everything hooks in via guarded method wraps
 * (same pattern news-events-v2 uses), and the state rides the
 * existing markets blob so the save is untouched
 * (SF.SAVE_VERSION NOT bumped).
 *
 * (1) Dynamic territory pricing: commodity prices gain a multiplier
 *     from faction-warfare territory control. Majority holder == the
 *     system's home faction -> "safe": sell +12%. Majority holder !=
 *     home faction -> "war-torn": buy -12%. Total clamped 0.5x-2.0x,
 *     recomputed on every dock (wrapped Trading.drift).
 * (2) Price-shock events: station news entries (READ-ONLY from
 *     SF.News — the "Market watch: <good> spiked/crashed" wire items
 *     Trading.drift pushes) open a 10-minute scarcity/surplus window
 *     on that commodity class. Scarcity: buy x1.25 / sell x1.35.
 *     Surplus: buy x0.75 / sell x0.70. Trade UI shows a countdown
 *     banner. Only affects that good, in that system.
 * (3) Contraband demand: a faction-warfare control flip starts a
 *     30-minute black-market demand surge — the fence's risk premium
 *     goes to x1.25. Note rendered under the fence panel.
 *
 * Persistence: additive on SF.Player.markets._dynamics, defensive
 * reads everywhere (old saves get a fresh blob). Expiries are
 * timestamp-based, so the windows survive a reload honestly.
 * ============================================================ */

SF.CONFIG.tradeDynamics = SF.CONFIG.tradeDynamics || {
  safeBuyMul: 1.0,    // safe system (home faction in control): buy neutral
  safeSellMul: 1.12,  //   — sell high in safe systems
  warBuyMul: 0.88,    // war-torn system (flip): buy low
  warSellMul: 0.97,   //   — sell slightly soft
  priceClampMin: 0.5, priceClampMax: 2.0,
  shockBuyMul: { scarcity: 1.25, surplus: 0.75 },
  shockSellMul: { scarcity: 1.35, surplus: 0.70 },
  shockMs: 600000,    // 10-minute windows
  demandMul: 1.25,    // contraband risk premium after a control flip
  demandMs: 1800000   // 30-minute demand surge
};

(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
  function dcfg() { return SF.CONFIG.tradeDynamics; }

  function goodsList() { return ((SF.CONFIG.trading || {}).goods) || []; }
  function goodNameToId(name) {
    var gs = goodsList();
    for (var i = 0; i < gs.length; i++) if (gs[i].name === name) return gs[i].id;
    // fuzzy: "Foodstuffs" vs "Food"
    var lo = String(name).toLowerCase();
    for (var j = 0; j < gs.length; j++) {
      if (gs[j].name.toLowerCase().indexOf(lo) === 0 || lo.indexOf(gs[j].name.toLowerCase()) === 0)
        return gs[j].id;
    }
    return null;
  }

  /* Defensive _dynamics blob on the existing markets object (save-neutral). */
  function blob() {
    var p = SF.Player;
    if (!p.markets || typeof p.markets !== 'object' || Array.isArray(p.markets)) p.markets = {};
    var d = p.markets._dynamics;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      d = { holders: {}, shocks: [], surge: { until: 0, mul: 1 }, lastNewsT: 0 };
      p.markets._dynamics = d;
    }
    if (!d.holders || typeof d.holders !== 'object' || Array.isArray(d.holders)) d.holders = {};
    if (!Array.isArray(d.shocks)) d.shocks = [];
    if (!d.surge || typeof d.surge !== 'object' || Array.isArray(d.surge))
      d.surge = { until: 0, mul: 1 };
    if (typeof d.lastNewsT !== 'number' || !isFinite(d.lastNewsT)) d.lastNewsT = 0;
    return d;
  }

  function now() { return Date.now(); }

  function curSys() { return (SF.Game && SF.Game.systemId) || 'solace'; }

  function sysName(id) {
    var s = SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id];
    return s ? s.name : id;
  }

  /* Station name -> system id, for news-driven shocks. */
  function systemOfStation(name) {
    if (!name) return null;
    var sysId = null;
    (SF.SYSTEMS || []).forEach(function (sys) {
      if (sys.station && sys.station.name === name) sysId = sys.id;
    });
    if (!sysId && SF.FACTION_HQ) {
      SF.FACTION_HQ.forEach(function (hq) { if (hq.name === name) sysId = hq.systemId; });
    }
    return sysId;
  }

  function fmtClock(ms) {
    if (ms <= 0) return '0:00';
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ---------- shock parsing (read-only off the news wire) ---------- */
  // drift() pushes: "📈 Market watch: Foodstuffs spiked +25% at Haven Dock."
  //                "📈 Market watch: Minerals crashed 12% at Verdant Depot."
  var SHOCK_RE = /Market watch:\s*(.+?)\s+(spiked \+\d+%|crashed \d+%)\s+at\s+(.+?)\./;

  function consumeNewsShocks() {
    if (!window.SF || !SF.News || !SF.News.latest) return 0;
    var d = blob(), n = 0, maxT = d.lastNewsT;
    var items = SF.News.latest(12);
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      if (!e || typeof e.t !== 'number' || e.t <= d.lastNewsT) continue;
      if (e.t > maxT) maxT = e.t;
      var m = SHOCK_RE.exec(String(e.text || ''));
      if (!m) continue;
      var gid = goodNameToId(m[1]);
      if (!gid) continue;
      var sysId = systemOfStation(m[3]) || curSys();
      // replace any live shock for the same good+system
      d.shocks = d.shocks.filter(function (s) {
        return !(s.goodId === gid && s.sysId === sysId && s.expiresAt > now());
      });
      d.shocks.push({
        goodId: gid, kind: m[2].indexOf('spiked') === 0 ? 'scarcity' : 'surplus',
        sysId: sysId, station: m[3], expiresAt: now() + dcfg().shockMs, wire: m[2]
      });
      n++;
    }
    d.lastNewsT = maxT;
    return n;
  }

  function purgeExpired() {
    var d = blob(), t = now(), changed = false;
    var kept = d.shocks.filter(function (s) { return s.expiresAt > t; });
    if (kept.length !== d.shocks.length) { d.shocks = kept; changed = true; }
    if (d.surge.until && d.surge.until <= t) { d.surge = { until: 0, mul: 1 }; changed = true; }
    return changed;
  }

  function activeShocks(sysId) {
    purgeExpired();
    var t = now();
    return blob().shocks.filter(function (s) {
      return s.sysId === sysId && s.expiresAt > t;
    });
  }

  function shockMul(sysId, goodId, side) {
    var shocks = activeShocks(sysId);
    for (var i = 0; i < shocks.length; i++) {
      if (shocks[i].goodId !== goodId) continue;
      var c = dcfg();
      var tab = side === 'buy' ? c.shockBuyMul : c.shockSellMul;
      return tab[shocks[i].kind] || 1;
    }
    return 1;
  }

  /* ---------- territory pricing ---------- */
  function warfareMul(sysId, side) {
    var c = dcfg();
    if (!window.SF || !SF.Factions || !SF.Factions.majority) return 1;
    var holder = SF.Factions.majority(sysId);
    if (!holder) return 1;
    var home = (SF.CONFIG.trading.systemFaction || {})[sysId];
    var safe = holder === home;
    return side === 'buy' ? (safe ? c.safeBuyMul : c.warBuyMul)
                          : (safe ? c.safeSellMul : c.warSellMul);
  }

  function surgeActive() {
    purgeExpired();
    return blob().surge.until > now();
  }

  /* ---------- CSS ---------- */
  function ensureCSS() {
    if (document.getElementById('trade-dyn-css')) return;
    var el = document.createElement('style');
    el.id = 'trade-dyn-css';
    el.textContent = [
      '#dyn-shock-banner{border:1px solid #ffd23f;border-radius:8px;padding:8px;margin-bottom:8px;',
      ' background:rgba(60,44,4,.55);font-size:12px;color:#ffe9a8}',
      '#dyn-shock-banner .dyn-head{font-weight:bold;color:#ffd23f;letter-spacing:1px;margin-bottom:4px}',
      '#dyn-shock-row{display:flex;justify-content:space-between;padding:2px 0}',
      '.dyn-up{color:#ff8a5e}.dyn-down{color:#3ddc5f}',
      '#dyn-demand-note{border:1px solid #e8b339;border-radius:8px;padding:6px 8px;margin-bottom:8px;',
      ' background:rgba(60,20,4,.5);font-size:12px;color:#ffc978}'
    ].join('\n');
    document.head.appendChild(el);
  }

  /* ---------- guarded wraps (same idempotent pattern as news.js) ---------- */
  /* wrap-once per method for THIS module's lifetime: other phases
   * (news.js) re-wrap the same methods at boot, which replaces the
   * function reference — the _dynWrapped flag on the replaced fn would
   * let a retry loop wrap a second time and double-apply multipliers. */
  var installed = {};
  function wrapOnce(obj, name, fn) {
    if (installed[name]) return true;
    if (!wrapMethod(obj, name, fn)) return false;
    installed[name] = true;
    return true;
  }
  function wrapMethod(obj, name, fn) {
    if (!obj || !obj[name]) return false;
    if (obj[name]._dynWrapped) return true;
    var orig = obj[name];
    if (typeof orig !== 'function') return false;
    var w = function () {
      var args = Array.prototype.slice.call(arguments);
      return fn.call(this, orig, args);
    };
    w._dynWrapped = true;
    obj[name] = w;
    return true;
  }

  var TradeDynamics = {

    /* Recomputed on every dock (hooked into Trading.drift). */
    recompute: function (st) {
      var sys = curSys(), d = blob(), t = now(), c = dcfg();
      if (!window.SF) return;
      // (3) control flips -> contraband demand surge
      if (SF.Factions && SF.Factions.majority) {
        var holder = SF.Factions.majority(sys);
        var prev = d.holders[sys] || null;
        if (holder && prev && holder !== prev) {
          d.surge = { until: t + c.demandMs, mul: c.demandMul };
          if (SF.News) SF.News.push('\uD83D\uDD25 CONTROL SHIFT — ' + sysName(sys) +
            ' under ' + (SF.FACTION_BY_ID && SF.FACTION_BY_ID[holder] ?
              SF.FACTION_BY_ID[holder].name : holder) +
            ' control. Black-market demand surging: fence pays ×' + c.demandMul + ' risk premium.');
        }
        if (holder) d.holders[sys] = holder;
      }
      // (2) news-driven price shocks (read-only off the wire)
      consumeNewsShocks();
      purgeExpired();
    },

    /* Test hook: force a control flip in a system (drives _dynWrapped flows). */
    forceFlip: function (sysId, toFaction) {
      if (!window.SF || !SF.Factions || !SF.Factions.adjust) return null;
      var me = toFaction || (SF.FACTION_LIST && SF.FACTION_LIST[1] && SF.FACTION_LIST[1].id);
      var r = SF.Factions.adjust(sysId, me, 100);
      this.recompute({ name: 'Haven Dock', kind: 'dock' });
      return r;
    },

    shocks: function (sysId) { return activeShocks(sysId || curSys()); },
    warfareMul: warfareMul,
    shockMul: shockMul,
    surgeActive: surgeActive,
    surgeInfo: function () { purgeExpired(); return blob().surge; },

    _blob: function () { return blob(); },
    _reset: function () {
      SF.Player.markets = SF.Player.markets || {};
      SF.Player.markets._dynamics =
        { holders: {}, shocks: [], surge: { until: 0, mul: 1 }, lastNewsT: 0 };
    },

    /* ---- trade UI: shock banner with countdown ---- */
    renderShockBanner: function (body, st) {
      ensureCSS();
      var old = document.getElementById('dyn-shock-banner');
      if (old) old.parentNode.removeChild(old);
      var shocks = activeShocks(curSys());
      if (!shocks.length) return;
      var t = now();
      var wrap = document.createElement('div');
      wrap.id = 'dyn-shock-banner';
      var head = document.createElement('div');
      head.className = 'dyn-head';
      head.textContent = '⚡ PRICE SHOCK — LIVE WINDOW';
      wrap.appendChild(head);
      shocks.forEach(function (s) {
        var g = null;
        goodsList().forEach(function (gg) { if (gg.id === s.goodId) g = gg; });
        var gname = g ? g.name : s.goodId;
        var up = s.kind === 'scarcity';
        var row = document.createElement('div');
        row.id = 'dyn-shock-row';
        row.setAttribute('data-good', s.goodId);
        row.setAttribute('data-kind', s.kind);
        row.innerHTML =
          '<span><b>' + gname + '</b> ' + (up ? '— scarcity' : '— surplus') +
          ' <span class="dim">(' + s.wire + ')</span></span>' +
          '<span class="' + (up ? 'dyn-up' : 'dyn-down') + '">' +
          (up ? 'BUY ×1.25 / SELL ×1.35' : 'BUY ×0.75 / SELL ×0.70') +
          ' · ' + fmtClock(s.expiresAt - t) + '</span>';
        wrap.appendChild(row);
      });
      body.insertBefore(wrap, body.firstChild);
    },

    renderDemandNote: function (body, st) {
      ensureCSS();
      if (!surgeActive()) return;
      var t = now(), s = blob().surge;
      var note = document.createElement('div');
      note.id = 'dyn-demand-note';
      note.textContent = '🔥 Black-market demand surging after the takeover — ' +
        'risk premium ×' + s.mul + ' (' + fmtClock(s.until - t) + ' left).';
      body.insertBefore(note, body.firstChild);
    }
  };

  SF.TradeDynamics = TradeDynamics;

  /* ---------- hook installs (idempotent, guarded, deferred-safe) ---------- */
  function hookAll() {
    if (!window.SF || !SF.Trading) return false;
    var ok = true;
    ok = wrapOnce(SF.Trading, 'drift', function (orig, args) {
      var r = orig.apply(this, args);
      try { SF.TradeDynamics.recompute(args[0]); } catch (e) {}
      return r;
    }) && ok;
    ok = wrapOnce(SF.Trading, 'price', function (orig, args) {
      var p = orig.apply(this, args);
      try {
        var c = dcfg();
        var m = 1;
        m *= SF.TradeDynamics.warfareMul(curSys(), args[2]);
        m *= SF.TradeDynamics.shockMul(curSys(), args[1], args[2]);
        m = clamp(m, c.priceClampMin, c.priceClampMax);
        p = args[2] === 'buy' ? Math.max(1, Math.ceil(p * m))
                              : Math.max(1, Math.floor(p * m));
      } catch (e) {}
      return p;
    }) && ok;
    ok = wrapOnce(SF.Trading, 'fencePrice', function (orig, args) {
      var p = orig.apply(this, args);
      try {
        if (SF.TradeDynamics.surgeActive())
          p = Math.ceil(p * SF.TradeDynamics.surgeInfo().mul);
      } catch (e) {}
      return p;
    }) && ok;
    ok = wrapOnce(SF.Trading, 'renderMarket', function (orig, args) {
      var r = orig.apply(this, args);
      try { SF.TradeDynamics.renderShockBanner(args[0], args[1]); } catch (e) {}
      return r;
    }) && ok;
    ok = wrapOnce(SF.Trading, 'renderFence', function (orig, args) {
      var r = orig.apply(this, args);
      try { SF.TradeDynamics.renderDemandNote(args[0], args[1]); } catch (e) {}
      return r;
    }) && ok;
    return ok;
  }

  hookAll();
  /* trading.js loads before some modules (SF.Factions may not exist yet at
   * parse time); retry briefly so the wraps land even in odd load orders. */
  (function () {
    var tries = 0;
    var iv = setInterval(function () {
      if (hookAll() || ++tries > 60) clearInterval(iv);
    }, 500);
  })();
})();

/* ============================================================
 * trading-ledger phase (2026-10-21): SF.Ledger — market price-history
 * ledger + session P/L.
 *
 * Per-good per-station price history: the last 10 OBSERVED prices per
 * good (recorded on every successful buy/sell, buy-side and sell-side),
 * with min/max/last readouts and a small canvas sparkline in the market
 * UI. Session P/L: credits earned on sales vs spent on buys since dock
 * (resets on every dock visit via the Trading.drift hook, plus a lazy
 * station-key check on market render).
 *
 * Persistence: additive blob on the existing trading blob
 * (SF.Player.markets._ledger), defensive reads everywhere — save-neutral,
 * SF.SAVE_VERSION is NOT bumped. Additive wrap-once hooks on
 * buy/sell/drift/renderMarket; no refactors of the trading pipeline.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  var MAX_TICKS = 10; /* last 10 observed prices per good per station */

  /* ---------- persistent blob (defensive; rides the existing markets blob) ---------- */
  function blob() {
    var p = SF.Player;
    if (!p.markets || typeof p.markets !== 'object' || Array.isArray(p.markets)) p.markets = {};
    var b = p.markets._ledger;
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      b = { hist: {}, pl: { dockKey: '', bought: 0, sold: 0 } };
      p.markets._ledger = b;
    }
    if (!b.hist || typeof b.hist !== 'object' || Array.isArray(b.hist)) b.hist = {};
    if (!b.pl || typeof b.pl !== 'object' || Array.isArray(b.pl))
      b.pl = { dockKey: '', bought: 0, sold: 0 };
    if (typeof b.pl.bought !== 'number' || !isFinite(b.pl.bought)) b.pl.bought = 0;
    if (typeof b.pl.sold !== 'number' || !isFinite(b.pl.sold)) b.pl.sold = 0;
    if (typeof b.pl.dockKey !== 'string') b.pl.dockKey = '';
    return b;
  }

  function stKey(st) {
    var name = (st && st.name) ? st.name : ((SF.Game && SF.Game.dockedAt) || '');
    return ((SF.Game && SF.Game.systemId) || '') + ':' + name;
  }

  /* ---------- price history ---------- */
  function record(st, goodId, unitPrice) {
    if (!goodId || typeof unitPrice !== 'number' || !isFinite(unitPrice) || unitPrice < 0) return;
    var key = stKey(st), b = blob();
    var h = b.hist[key];
    if (!h || typeof h !== 'object' || Array.isArray(h)) { h = {}; b.hist[key] = h; }
    var t = h[goodId];
    if (!Array.isArray(t)) t = [];
    t.push(Math.round(unitPrice));
    while (t.length > MAX_TICKS) t.shift(); /* FIFO ring buffer */
    h[goodId] = t;
  }

  function ticks(st, goodId) {
    var h = blob().hist[stKey(st)];
    if (!h || typeof h !== 'object' || Array.isArray(h)) return [];
    var t = h[goodId];
    if (!Array.isArray(t)) return [];
    return t.filter(function (v) { return typeof v === 'number' && isFinite(v); });
  }

  /* ---------- session P/L (credits since dock) ---------- */
  function sessionPl(st) {
    var b = blob(), key = stKey(st);
    if (b.pl.dockKey !== key) b.pl = { dockKey: key, bought: 0, sold: 0 };
    return b.pl;
  }

  var Ledger = {

    MAX_TICKS: MAX_TICKS,

    key: stKey,

    /* one observed unit price for a good at a station */
    record: record,

    /* number[] of observed prices, oldest first */
    ticks: ticks,

    /* {min, max, last, n} or null when nothing observed */
    stats: function (st, goodId) {
      var t = ticks(st, goodId);
      if (!t.length) return null;
      var mn = t[0], mx = t[0], i;
      for (i = 1; i < t.length; i++) {
        if (t[i] < mn) mn = t[i];
        if (t[i] > mx) mx = t[i];
      }
      return { min: mn, max: mx, last: t[t.length - 1], n: t.length };
    },

    /* {bought, sold, net} credits since the current dock visit */
    session: function (st) {
      var pl = sessionPl(st);
      return { bought: pl.bought, sold: pl.sold, net: pl.sold - pl.bought };
    },

    /* test hook: drop the blob (lazy-rebuilt on next read) */
    wipe: function () {
      var p = SF.Player;
      if (p && p.markets && typeof p.markets === 'object') delete p.markets._ledger;
    }
  };

  SF.Ledger = Ledger;

  /* ---------- additive hooks (wrap-once so sibling phases compose) ---------- */
  function wrapOnce(obj, name, tag, fn) {
    if (!obj || typeof obj[name] !== 'function') return false;
    var f = obj[name];
    if (f['__ledgerWrapped_' + tag]) return true;
    var w = function () { return fn.call(this, f, Array.prototype.slice.call(arguments)); };
    w['__ledgerWrapped_' + tag] = true;
    obj[name] = w;
    return true;
  }

  /* record the observed price + session spend on every successful buy */
  wrapOnce(SF.Trading, 'buy', 'buy', function (orig, args) {
    var st = args[0], goodId = args[1], n = args[2] || 1;
    var unit = 0;
    try { unit = SF.Trading.price(st, goodId, 'buy'); } catch (e) {}
    var ok = orig.apply(this, args);
    if (ok && unit > 0) {
      try {
        record(st, goodId, unit);
        sessionPl(st).bought += unit * n;
      } catch (e) {}
    }
    return ok;
  });

  /* record the observed price + session earnings on every successful sell */
  wrapOnce(SF.Trading, 'sell', 'sell', function (orig, args) {
    var st = args[0], goodId = args[1], n = args[2] || 1;
    var unit = 0;
    try { unit = SF.Trading.price(st, goodId, 'sell'); } catch (e) {}
    var ok = orig.apply(this, args);
    if (ok && unit > 0) {
      try {
        record(st, goodId, unit);
        sessionPl(st).sold += unit * n;
      } catch (e) {}
    }
    return ok;
  });

  /* new dock visit -> new session */
  wrapOnce(SF.Trading, 'drift', 'drift', function (orig, args) {
    var r = orig.apply(this, args);
    try {
      var b = blob();
      b.pl = { dockKey: stKey(args[0]), bought: 0, sold: 0 };
    } catch (e) {}
    return r;
  });

  /* ---------- market UI: ledger block ---------- */
  function ensureCSS() {
    if (document.getElementById('ledger-css')) return;
    var css = [
      '.ledger-block{margin-top:10px}',
      '.ledger-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px dotted #22314f}',
      '.ledger-name{width:96px;font-size:12px;color:#cfe0ff;flex:none}',
      '.ledger-stats{font-size:11px;color:#8fa3c8;flex:1;line-height:1.5}',
      '.ledger-pl-up{color:#3ddc5f}',
      '.ledger-pl-down{color:#ff5e3a}',
      '.ledger-pl-flat{color:#9fb3d9}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'ledger-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function drawSpark(canvas, t) {
    try {
      var dpr = window.devicePixelRatio || 1;
      var W = 120, H = 28;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      var mn = t[0], mx = t[0], i;
      for (i = 1; i < t.length; i++) {
        if (t[i] < mn) mn = t[i];
        if (t[i] > mx) mx = t[i];
      }
      var span = mx - mn;
      ctx.strokeStyle = '#39d5e8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (t.length === 1) {
        ctx.moveTo(4, H / 2);
        ctx.lineTo(W - 4, H / 2);
      } else {
        for (i = 0; i < t.length; i++) {
          var x = 4 + i * ((W - 8) / (t.length - 1));
          var y = span > 0 ? (H - 4) - ((t[i] - mn) / span) * (H - 8) : H / 2;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      /* last-point dot */
      ctx.fillStyle = '#3ddc5f';
      var lx = t.length === 1 ? W - 4 : 4 + (t.length - 1) * ((W - 8) / (t.length - 1));
      var spanS = span > 0 ? span : 1;
      var ly = t.length === 1 ? H / 2 : (H - 4) - ((t[t.length - 1] - mn) / spanS) * (H - 8);
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, 6.2832);
      ctx.fill();
      canvas.setAttribute('data-spark-done', '1');
    } catch (e) { /* canvas unavailable — leave blank */ }
  }

  function renderInto(body, st) {
    ensureCSS();
    var pl = sessionPl(st); /* lazy reset if the station changed since the blob was written */
    var wrap = document.createElement('div');
    wrap.className = 'ledger-block';
    wrap.id = 'ledger-block';

    var h = document.createElement('div');
    h.className = 'store-head';
    h.textContent = '📊 PRICE LEDGER';
    wrap.appendChild(h);

    var net = pl.sold - pl.bought;
    var nc = net > 0 ? 'ledger-pl-up' : (net < 0 ? 'ledger-pl-down' : 'ledger-pl-flat');
    var sline = document.createElement('div');
    sline.className = 'store-desc';
    sline.id = 'ledger-session';
    sline.style.marginBottom = '4px';
    sline.innerHTML = 'SESSION (since dock) — sold <b>+' + fmt(pl.sold) + 'c</b> · bought <b>−' +
      fmt(pl.bought) + 'c</b> · net <b class="' + nc + '">' + (net >= 0 ? '+' : '−') +
      fmt(Math.abs(net)) + 'c</b>';
    wrap.appendChild(sline);

    var goods = (SF.CONFIG.trading && SF.CONFIG.trading.goods) || [];
    goods.forEach(function (g) {
      var s = Ledger.stats(st, g.id);
      var row = document.createElement('div');
      row.className = 'ledger-row';
      row.setAttribute('data-good', g.id);
      var nm = document.createElement('div');
      nm.className = 'ledger-name';
      nm.textContent = g.name;
      row.appendChild(nm);
      if (s) {
        var cv = document.createElement('canvas');
        cv.id = 'ledger-spark-' + g.id;
        cv.className = 'ledger-spark';
        row.appendChild(cv);
        drawSpark(cv, ticks(st, g.id));
        var st2 = document.createElement('div');
        st2.className = 'ledger-stats';
        st2.id = 'ledger-stats-' + g.id;
        st2.innerHTML = 'last <b>' + fmt(s.last) + 'c</b> · min ' + fmt(s.min) +
          'c · max ' + fmt(s.max) + 'c <span class="dim">(' + s.n + ' obs)</span>';
        row.appendChild(st2);
      } else {
        var none = document.createElement('div');
        none.className = 'ledger-stats dim';
        none.id = 'ledger-stats-' + g.id;
        none.textContent = 'no trades observed yet at this station';
        row.appendChild(none);
      }
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }

  wrapOnce(SF.Trading, 'renderMarket', 'renderMarket', function (orig, args) {
    var r = orig.apply(this, args);
    try { renderInto(args[0], args[1]); } catch (e) {}
    return r;
  });
})();

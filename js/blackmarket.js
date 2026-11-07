/* ============================================================
 * STARFALL — planets-facilities phase: SF.BlackMarket
 *
 * A real contraband market UI: illegal goods (buy/sell, notorious
 * captains get better prices via SF.Factions.blackMarketMul()),
 * shady jobs (instant credits, karma/standing consequences, heat),
 * forged transit papers (consumable, 1500c, stacks; each waives the next
 * civilized-station customs scan — the scan is skipped via a runtime
 * wrapper on SF.Customs.onDock installed by this module, never by
 * editing js/station.js),
 * and the market's own drifting prices.
 * Available at planets with the 'blackmarket' facility + the Ember
 * and Drifter faction HQs.
 * Save: SF.Player.bmarket {mul:{}, jobsDone:[], papers:n} — save-neutral,
 * no SAVE_VERSION bump; reads are defensive (old saves just show 0).
 * ============================================================
 *
 * blackmarket-papers phase (2026-10-19): forged transit papers.
 * Papers live in the bmarket blob (papers: n, integer >= 0). The customs
 * scan hook (SF.Customs.onDock, smuggling-runs) is wrapped at load:
 * on the next dock with contraband aboard at a civilized station, one
 * paper is consumed and the scan is skipped entirely (no pending scan,
 * no panel, no fine, no standing/karma change). With no papers the
 * original scan path runs untouched. Papers take no cargo space. */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function cfg() { return SF.CONFIG.contraband; }
  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  function st() {
    var p = SF.Player;
    if (!p.bmarket) p.bmarket = { mul: {}, jobsDone: [] };
    return p.bmarket;
  }

  /* Market multiplier per black-market site; drifts per visit. */
  function siteKey(site) { return site; }
  function mulFor(site) {
    var s = st();
    if (!s.mul[siteKey(site)]) s.mul[siteKey(site)] = 1.0;
    return s.mul[siteKey(site)];
  }
  function drift(site) {
    var s = st();
    var m = mulFor(site);
    m = Math.max(0.6, Math.min(1.8, m * (1 + (Math.random() * 2 - 1) * 0.10)));
    s.mul[siteKey(site)] = Math.round(m * 1000) / 1000;
  }

  function buyPrice(g, site) {
    var m = mulFor(site);
    var bm = (window.SF && SF.Factions) ? SF.Factions.blackMarketMul() : 1;
    return Math.ceil(g.base * m * bm);
  }
  function sellPrice(g, site) {
    return Math.floor(buyPrice(g, site) * cfg().sellSpread);
  }

  function contraband() { return SF.Player.contraband || {}; }

  /* ---- blackmarket-papers: forged transit papers ---- */
  var PAPERS_PRICE = 1500;

  /* Defensive read: old saves have no papers key. */
  function paperCount() {
    var s = st();
    var n = s.papers;
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function setPaperCount(n) {
    var s = st();
    s.papers = Math.max(0, Math.floor(n));
  }

  /* Customs tons, mirroring SF.Customs.tons() without depending on it. */
  function customsTons() {
    var inv = contraband(), t = 0;
    Object.keys(inv).forEach(function (k) { t += inv[k] || 0; });
    return Math.floor(t);
  }

  /* Consume one paper to waive a would-be scan. Returns true if waived. */
  function waiveScan(st) {
    if (!st || (st.kind !== 'dock' && st.kind !== 'homebase')) return false;
    if (customsTons() <= 0) return false;
    if (paperCount() <= 0) return false;
    setPaperCount(paperCount() - 1);
    // make sure no stale inspection panel lingers
    if (window.SF && SF.Customs) SF.Customs.pending = null;
    var old = document.getElementById('customs-panel');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (window.SF && SF.News) SF.News.push('\uD83D\uDCC3 A captain with forged transit papers walked out of a ' +
      'customs inspection at ' + (SF.Game.dockedAt || 'a station') + ' — papers burned, questions asked.');
    if (window.SF && SF.Audio && SF.Audio.buy) SF.Audio.buy();
    if (window.SF && SF.HUD) SF.HUD.toast('\uD83D\uDCC3 Transit papers accepted — customs waves you through. (' +
      paperCount() + ' left)');
    if (window.SF && SF.Save) SF.Save.save();
    return true;
  }

  /* Wrap SF.Customs.onDock at runtime (js/station.js is never edited):
   * first scan with papers aboard at a civilized station is waived. */
  function installScanHook() {
    if (installScanHook.done) return;
    installScanHook.tries = (installScanHook.tries || 0) + 1;
    if (!window.SF || !SF.Customs || !SF.Customs.onDock) {
      if (installScanHook.tries < 100) setTimeout(installScanHook, 100); // give up after ~10s
      return;
    }
    var origOnDock = SF.Customs.onDock;
    SF.Customs.onDock = function (st) {
      if (waiveScan(st)) return; // scan skipped entirely: no fine, no standing change
      return origOnDock.call(SF.Customs, st);
    };
    installScanHook.done = true;
  }

  var BlackMarket = {

    heat: false, // set by risky jobs; checked on undock for an ambush

    drift: drift,

    /* blackmarket-papers: forged transit papers (consumable, 1500c, stacks). */
    papers: paperCount,
    papersPrice: PAPERS_PRICE,
    buyPaper: function (site) {
      var p = SF.Player;
      if (p.credits < PAPERS_PRICE) {
        if (window.SF && SF.Audio) SF.Audio.deny();
        return false;
      }
      p.credits -= PAPERS_PRICE;
      setPaperCount(paperCount() + 1);
      if (window.SF && SF.Save) SF.Save.save();
      return true;
    },
    /* Test/debug hook: run the customs-scan entry point through the papers check. */
    maybeWaiveScan: waiveScan,

    /* Entry point: opens the black-market overlay panel. */
    open: function (site) {
      site = site || 'unknown';
      drift(site);
      var body = $('blackmarket-body');
      body.innerHTML = '';
      var p = SF.Player, c = cfg(), self = this;

      var title = $('blackmarket-title');
      title.textContent = '\uD83D\uDD76 BLACK MARKET — ' + site.toUpperCase();

      var note = document.createElement('div');
      note.className = 'dim';
      note.style.marginBottom = '6px';
      var k = (window.SF && SF.Factions) ? SF.Factions.karma() : 0;
      var bm = (window.SF && SF.Factions) ? SF.Factions.blackMarketMul() : 1;
      note.textContent = 'No names, no manifests. ' +
        (k <= -30 ? 'The fences know your reputation — prices \u00D7' + bm.toFixed(2) + '.' :
         k >= 15 ? 'You look like a cop. Prices \u00D7' + bm.toFixed(2) + '.' :
         'Cash only. The underworld is watching.');
      body.appendChild(note);

      // ---- contraband buy/sell ----
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'CONTRABAND'; body.appendChild(h);

      var hold = p.cargoUsed(), space = p.cargoSpace();
      var holdLine = document.createElement('div');
      holdLine.className = 'dim'; holdLine.style.marginBottom = '4px';
      holdLine.textContent = 'Credits: ' + fmt(p.credits) + 'c · Hold: ' + hold + '/' + space + 't' +
        ' · \uD83D\uDCC3 Papers: ×' + paperCount();
      body.appendChild(holdLine);

      var inv = contraband();
      c.goods.forEach(function (g) {
        var bp = buyPrice(g, site), sp = sellPrice(g, site);
        var have = inv[g.id] || 0;
        var div = document.createElement('div');
        div.className = 'store-row';
        var info = document.createElement('div');
        info.className = 'store-info';
        info.innerHTML = '<div><div class="store-name">' + g.name +
          (have ? ' <span class="dim">\u00D7' + have + '</span>' : '') + '</div>' +
          '<div class="store-desc">' + g.desc + '<br>Buy ' + fmt(bp) + 'c/t · Sell ' + fmt(sp) + 'c/t</div></div>';
        div.appendChild(info);

        var bb = document.createElement('button');
        bb.className = 'btn store-btn';
        bb.textContent = 'BUY';
        var room = space - hold;
        if (p.credits < bp || room < 1) bb.disabled = true;
        bb.addEventListener('click', function () {
          if (p.credits < bp || p.cargoUsed() >= p.cargoSpace()) { SF.Audio.deny(); return; }
          p.credits -= bp;
          inv[g.id] = (inv[g.id] || 0) + 1;
          p.contraband = inv;
          if (window.SF && SF.Factions) SF.Factions.shiftKarma(c.karmaPerBuy);
          SF.Audio.buy(); SF.Save.save(); self.open(site);
          SF.HUD.toast(g.name + ' stashed. Nobody saw anything.');
        });
        div.appendChild(bb);

        if (have > 0) {
          var sb = document.createElement('button');
          sb.className = 'btn store-btn';
          sb.textContent = 'SELL';
          sb.addEventListener('click', function () {
            inv[g.id]--;
            if (inv[g.id] <= 0) delete inv[g.id];
            p.contraband = inv;
            p.credits += sp;
            SF.Audio.credit && SF.Audio.credit(); SF.Save.save(); self.open(site);
            SF.HUD.toast('Sold ' + g.name + ': +' + fmt(sp) + 'c.');
          });
          div.appendChild(sb);
        }
        body.appendChild(div);
      });

      // ---- blackmarket-papers: forged transit papers ----
      var hp = document.createElement('div'); hp.className = 'store-head';
      hp.textContent = 'FORGED TRANSIT PAPERS'; body.appendChild(hp);
      var pdiv = document.createElement('div');
      pdiv.className = 'store-row';
      var pinfo = document.createElement('div');
      pinfo.className = 'store-info';
      pinfo.innerHTML = '<div><div class="store-name">\uD83D\uDCC3 Transit Papers <span class="dim">×' +
        paperCount() + '</span></div>' +
        '<div class="store-desc">Flawless forgeries. The next customs inspection at a civilized ' +
        'station is waived — papers burned, no fine, no questions. ' + fmt(PAPERS_PRICE) +
        'c each, stacks without touching cargo space.</div></div>';
      pdiv.appendChild(pinfo);
      var pb = document.createElement('button');
      pb.className = 'btn store-btn';
      pb.textContent = 'BUY · ' + fmt(PAPERS_PRICE) + 'c';
      if (p.credits < PAPERS_PRICE) pb.disabled = true;
      pb.addEventListener('click', function () {
        if (p.credits < PAPERS_PRICE) { SF.Audio.deny(); return; }
        p.credits -= PAPERS_PRICE;
        setPaperCount(paperCount() + 1);
        SF.Audio.buy(); SF.Save.save(); self.open(site);
        SF.HUD.toast('\uD83D\uDCC3 Papers forged. The inspector will never know. (' +
          paperCount() + ' held)');
      });
      pdiv.appendChild(pb);
      body.appendChild(pdiv);

      // ---- blackmarket-auctions: timed auction house (additive; the lot,
      // ---- timer and NPC bidding live in module-level runtime state) ----
      var adiv = document.createElement('div');
      adiv.id = 'bm-auction';
      body.appendChild(adiv);
      if (!auction) startAuction();
      renderAuction(adiv, site);
      startPanelTimer(site);

      // ---- shady jobs ----
      var h2 = document.createElement('div'); h2.className = 'store-head';
      h2.textContent = 'SHADY JOBS'; body.appendChild(h2);
      var s = st();
      SF.BLACKMARKET_JOBS.forEach(function (j) {
        var done = s.jobsDone.indexOf(j.id) >= 0;
        var div = document.createElement('div');
        div.className = 'store-row';
        div.innerHTML = '<div class="store-info"><div><div class="store-name">' + j.name + '</div>' +
          '<div class="store-desc">' + j.desc + '<br>Pays <b>' + fmt(j.reward) + 'c</b> · ' +
          'Karma ' + j.karma + ' · Heat risk ' + Math.round(j.heat * 100) + '%</div></div></div>';
        var jb = document.createElement('button');
        jb.className = 'btn store-btn';
        jb.textContent = done ? 'DONE' : 'TAKE';
        jb.disabled = done;
        if (!done) jb.addEventListener('click', function () { self.takeJob(j, site); });
        div.appendChild(jb);
        body.appendChild(div);
      });

      SF.Game.showOverlay('overlay-blackmarket');
    },

    close: function () { stopPanelTimer(); SF.Game.hideOverlay('overlay-blackmarket'); },

    takeJob: function (j, site) {
      var p = SF.Player, s = st();
      p.credits += j.reward;
      if (window.SF && SF.Factions) {
        SF.Factions.shiftKarma(j.karma);
        Object.keys(j.stand || {}).forEach(function (f) { SF.Factions.shift(f, j.stand[f]); });
      }
      s.jobsDone.push(j.id);
      if (Math.random() < j.heat) this.heat = true;
      if (window.SF && SF.News) {
        SF.News.push('\uD83D\uDD76 Underworld wire: a \u201C' + j.name.toLowerCase() +
          '\u201D went down near ' + site + '. Fences are talking.');
      }
      SF.Audio.credit && SF.Audio.credit();
      SF.Save.save();
      this.open(site);
      SF.HUD.toast('Job done: +' + j.reward + 'c. ' +
        (this.heat ? 'Someone saw your ship. Careful out there.' : 'Clean getaway.'));
    },

    /* Called by SF.Station.undock: customs sweep + heat ambush. */
    onUndock: function () {
      var p = SF.Player;
      var inv = p.contraband || {};
      var tons = Object.keys(inv).reduce(function (a, k) { return a + (inv[k] || 0); }, 0);
      if (tons > 0 && Math.random() < 0.10) {
        var fine = Math.min(p.credits, 300);
        p.credits -= fine;
        if (window.SF && SF.News) SF.News.push('\uD83D\uDE94 Compact customs sweep caught a smuggler with ' +
          tons + 't of contraband — fined ' + fine + 'c.');
        SF.HUD.toast('Customs sweep! Fined ' + fine + 'c for contraband.');
      }
      if (this.heat) {
        this.heat = false;
        SF.HUD.toast('\u26A0 A patrol was waiting outside — word travels fast.');
        if (window.SF && SF.Enemies && SF.Enemies.spawnPatrol) {
          SF.Enemies.spawnPatrol(SF.Game.systemId, p.x + 350, p.y - 200);
        }
      }
    }
  };

  /* ============================================================
   * blackmarket-auctions (2026-10-20): timed auctions for rare parts/mods.
   *
   * One lot (a rare ship part or weapon mod, blue tier or better, drawn
   * from SF.PARTS / SF.MODS — craftOnly-flagged items included) is posted
   * on a 10-minute rotation. 2-3 NPC bidders drive the price up in seeded
   * (mulberry32) increments roughly every 20s. The player bids from the
   * black-market panel; the winning bid grants the item immediately with
   * the exact credit deduction. Being outbid or letting the timer expire
   * costs nothing.
   *
   * SAVE-NEUTRAL: all auction state is module-level runtime state (never
   * on SF.Player, never in the save blob). Do NOT bump SF.SAVE_VERSION.
   * ============================================================ */

  var AUCTION_MS = 10 * 60 * 1000;   // one lot per 10 minutes
  var NPC_BID_MS = 20 * 1000;        // ~20s between NPC bids
  var RESULT_SHOW_MS = 12000;        // result banner lingers in the panel

  var BIDDER_NAMES = ['Vex "Coldwallet" Ral', 'Sable Marr', 'The Quartermaster',
                      'Nyx', 'Old Kessler', 'Daggit Vane'];

  var TIER_ORDER = ['white', 'green', 'blue', 'purple', 'orange', 'gold'];
  var TIER_COLOR = { white: '#e8e8e8', green: '#3ddc5f', blue: '#3fa9ff',
                     purple: '#b45cff', orange: '#ff9f2e', gold: '#ffd94a' };

  var auction = null;      // current lot (runtime only, never saved)
  var auctionRound = 0;    // increments per lot; panel shows "lot #N"
  var lastResult = null;   // {round, lot, winner, bid, granted, charged}
  var lastResultAt = 0;
  var panelTimer = null;

  /* Deterministic RNG so NPC bid increments are seeded per auction. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tierIdx(t) { return TIER_ORDER.indexOf(t); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    s -= m * 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function aucToast(msg) { if (window.SF && SF.HUD) SF.HUD.toast(msg); }
  function aucNews(msg) { if (window.SF && SF.News) SF.News.push(msg); }

  /* Rare lots: blue+ ship parts (craftOnly included) + blue+ weapon mods. */
  function lotPool() {
    return {
      parts: (SF.PARTS || []).filter(function (p) { return tierIdx(p.tier) >= 2; }),
      mods: (SF.MODS || []).filter(function (m) { return tierIdx(m.tier) >= 2; })
    };
  }

  function pickLot(rand, pool) {
    var total = pool.parts.length + pool.mods.length;
    if (total <= 0) return null;
    var i = Math.floor(rand() * total);
    if (i < pool.parts.length) {
      var p = pool.parts[i];
      return { kind: 'part', id: p.id, name: p.name, tier: p.tier,
               type: p.type, value: p.price, desc: p.desc || '' };
    }
    var m = pool.mods[i - pool.parts.length];
    return { kind: 'mod', id: m.id, name: m.name, tier: m.tier,
             type: 'mod', value: m.price, desc: m.desc || '' };
  }

  function minInc(a) { return Math.max(25, Math.ceil(a.currentBid * 0.05)); }

  function startAuction(opts) {
    opts = opts || {};
    var seed = (opts.seed != null) ? (opts.seed >>> 0) : ((Math.random() * 4294967296) >>> 0);
    var rand = mulberry32(seed);
    var pool = lotPool();
    var lot = pickLot(rand, pool);
    if (!lot) return null;
    var startBid = Math.max(50, Math.round(lot.value * (0.55 + rand() * 0.25)));
    var nNpcs = 2 + Math.floor(rand() * 2); // 2-3 NPC bidders
    var names = BIDDER_NAMES.slice();
    for (var s = names.length - 1; s > 0; s--) { // seeded shuffle
      var j = Math.floor(rand() * (s + 1));
      var tmp = names[s]; names[s] = names[j]; names[j] = tmp;
    }
    var npcs = names.slice(0, nNpcs).map(function (nm) {
      return { name: nm, maxBid: Math.round(startBid * (1.5 + rand() * 1.3)), active: true };
    });
    var durationMs = opts.durationMs || AUCTION_MS;
    var npcEveryMs = opts.npcEveryMs || NPC_BID_MS;
    var now = Date.now();
    auctionRound++;
    auction = {
      round: auctionRound, seed: seed, lot: lot,
      startBid: startBid, currentBid: startBid, leader: null,
      bids: [], npcs: npcs,
      startsAt: now, endsAt: now + durationMs,
      nextBidAt: now + Math.round(npcEveryMs * (0.75 + rand() * 0.5)),
      npcEveryMs: npcEveryMs, resolved: false, _rand: rand,
      _warn30: false, _warn10: false // auctioneer-voice: one-shot timer warnings
    };
    // arena-announcer-voice-wiring-retry: new lot posted — auctioneer promo
    if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_07');
    return auction;
  }

  /* One NPC bid round: a random still-interested bidder raises by a seeded
   * increment; bidders whose ceiling is passed drop out quietly. */
  function npcBid(a) {
    var act = a.npcs.filter(function (n) { return n.active && n.name !== a.leader; });
    if (!act.length) return false;
    var npc = act[Math.floor(a._rand() * act.length)];
    var inc = Math.max(25, Math.ceil(a.currentBid * (0.06 + a._rand() * 0.12)));
    var nb = a.currentBid + inc;
    if (nb > npc.maxBid) { npc.active = false; return 'dropout'; }
    var outbidPlayer = (a.leader === 'player'); // auctioneer-voice: outbid line
    a.currentBid = nb;
    a.leader = npc.name;
    a.bids.push({ who: npc.name, amt: nb, t: Date.now() });
    // arena-announcer-voice-wiring-retry: auctioneer calls each NPC bid;
    // an NPC outbidding the player gets the "outbid" line
    if (window.SF && SF.AuctionVoice)
      SF.AuctionVoice.play(outbidPlayer ? 'auction_05' : 'auction_02');
    return true;
  }

  /* Player bid: exactly current + min increment. Credits are NOT escrowed —
   * the hammer price is deducted only if the player wins. */
  function placeBid() {
    var a = auction;
    if (!a || a.resolved) return { ok: false, reason: 'no-auction' };
    var now = Date.now();
    if (now >= a.endsAt) { catchUp(now); return { ok: false, reason: 'ended' }; }
    var next = a.currentBid + minInc(a);
    if (a.leader === 'player') return { ok: false, reason: 'leading' };
    if (SF.Player.credits < next) {
      if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny();
      return { ok: false, reason: 'funds' };
    }
    a.currentBid = next;
    a.leader = 'player';
    a.bids.push({ who: 'player', amt: next, t: now });
    if (window.SF && SF.Audio && SF.Audio.ui) SF.Audio.ui();
    // arena-announcer-voice-wiring-retry: player bid — "we have a bid"
    if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_02');
    return { ok: true, bid: next };
  }

  function grantLot(lot) {
    if (lot.kind === 'part' && SF.Player.addPart) SF.Player.addPart(lot.id, 1);
    else if (lot.kind === 'mod' && window.SF && SF.Mods && SF.Mods.addMod) SF.Mods.addMod(lot.id);
  }

  function resolve(a) {
    a.resolved = true;
    var res = { round: a.round, lot: a.lot, winner: a.leader,
                bid: a.currentBid, granted: false, charged: 0 };
    var p = SF.Player;
    if (a.leader === 'player') {
      if (p.credits >= a.currentBid) {
        p.credits -= a.currentBid;
        res.charged = a.currentBid;
        grantLot(a.lot);
        res.granted = true;
        if (window.SF && SF.Save) SF.Save.save();
        aucToast('🏆 You won the ' + a.lot.name + ' for ' + fmt(a.currentBid) +
                 'c — granted to inventory.');
        aucNews('🔨 Auction: ' + a.lot.name + ' went to a private bidder for ' +
                fmt(a.currentBid) + 'c at the black market.');
        if (window.SF && SF.Audio && SF.Audio.credit) SF.Audio.credit();
        // arena-announcer-voice-wiring-retry: sold line on player win
        if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_04');
      } else {
        // Credits were spent elsewhere mid-auction: forfeit the lot, charge nothing.
        res.winner = 'player-unpaid';
        aucToast('🔨 You won ' + a.lot.name + ' but could not cover ' +
                 fmt(a.currentBid) + 'c — lot forfeited, no charge.');
      }
    } else if (a.leader) {
      aucToast('🔨 Outbid on ' + a.lot.name + ' (' + fmt(a.currentBid) + 'c to ' +
               a.leader + ') — no charge.');
      aucNews('🔨 Auction: ' + a.lot.name + ' sold for ' + fmt(a.currentBid) + 'c.');
      if (window.SF && SF.Audio && SF.Audio.deny) SF.Audio.deny(); // sfx-hooks-v34b-retry: auction_lose
      // arena-announcer-voice-wiring-retry: outbid line when an NPC takes it
      if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_05');
    } else {
      aucToast('🔨 No bids on ' + a.lot.name + ' — lot withdrawn.');
      if (window.SF && SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack(); // sfx-hooks-v34b-retry: auction_expire
      // arena-announcer-voice-wiring-retry: withdrawn line
      if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_06');
    }
    lastResult = res;
    lastResultAt = Date.now();
    startAuction(); // the 10-minute rotation continues: fresh lot posts immediately
  }

  /* Drive all due NPC bids and resolve if the timer lapsed. Called by the
   * panel tick and on every public entry point, so the auction keeps its
   * own time even while the panel is closed. */
  function catchUp(now) {
    now = now || Date.now();
    var a = auction;
    if (!a) return;
    var guard = 0;
    while (!a.resolved && a.nextBidAt <= now && now < a.endsAt && guard++ < 500) {
      npcBid(a);
      a.nextBidAt += Math.round(a.npcEveryMs * (0.75 + a._rand() * 0.5));
    }
    // arena-announcer-voice-wiring-retry: auctioneer timer warnings,
    // once per lot (runtime flags only — save-neutral)
    if (!a.resolved) {
      var msLeft = a.endsAt - now;
      if (!a._warn30 && msLeft <= 30000) {
        a._warn30 = true;
        if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_08');
      }
      if (!a._warn10 && msLeft <= 10000) {
        a._warn10 = true;
        if (window.SF && SF.AuctionVoice) SF.AuctionVoice.play('auction_03');
      }
    }
    if (!a.resolved && now >= a.endsAt) resolve(a);
  }

  /* JSON-safe snapshot for the UI and tests (drops the RNG closure). */
  function publicState() {
    var a = auction;
    if (!a) return null;
    return {
      round: a.round, seed: a.seed,
      lot: { kind: a.lot.kind, id: a.lot.id, name: a.lot.name,
             tier: a.lot.tier, value: a.lot.value },
      startBid: a.startBid, currentBid: a.currentBid, leader: a.leader,
      bids: a.bids.map(function (b) { return { who: b.who, amt: b.amt }; }),
      npcs: a.npcs.map(function (n) { return { name: n.name, maxBid: n.maxBid, active: n.active }; }),
      msLeft: Math.max(0, a.endsAt - Date.now()), resolved: a.resolved
    };
  }

  function recentBidsHTML(a) {
    if (!a.bids.length)
      return '<div class="store-desc dim">No bids yet — opening at ' + fmt(a.startBid) + 'c.</div>';
    return a.bids.slice(-5).reverse().map(function (b) {
      var who = b.who === 'player' ? 'YOU' : b.who;
      return '<div class="dim">· ' + esc(who) + ' — ' + fmt(b.amt) + 'c</div>';
    }).join('');
  }

  function resultBannerHTML(res) {
    var msg;
    if (res.winner === 'player' && res.granted)
      msg = '🏆 You won <b>' + esc(res.lot.name) + '</b> for ' + fmt(res.charged) +
            'c — granted to inventory.';
    else if (res.winner === 'player')
      msg = '🔨 You won <b>' + esc(res.lot.name) + '</b> but could not cover the bid — ' +
            'lot forfeited, no charge.';
    else if (res.winner)
      msg = '🔨 <b>' + esc(res.lot.name) + '</b> went to ' + esc(res.winner) + ' for ' +
            fmt(res.bid) + 'c — no charge to you.';
    else
      msg = '🔨 No bids on <b>' + esc(res.lot.name) + '</b> — lot withdrawn.';
    return '<div class="store-row"><div class="store-info"><div><div class="store-desc">' +
           msg + '</div></div></div></div>';
  }

  function renderAuction(adiv, site) {
    if (!auction) startAuction();
    catchUp();
    var a = auction, now = Date.now();
    var html = '';
    if (lastResult && lastResult.round === a.round - 1 && now - lastResultAt < RESULT_SHOW_MS)
      html += resultBannerHTML(lastResult);
    var left = Math.max(0, a.endsAt - now);
    var next = a.currentBid + minInc(a);
    var leaderLabel = a.leader === 'player' ? 'YOU' : (a.leader || '—');
    var tierColor = TIER_COLOR[a.lot.tier] || '#e8e8e8';
    html += '<div class="store-head">🔨 AUCTION HOUSE <span class="dim">lot #' + a.round + '</span></div>';
    html += '<div class="store-row"><div class="store-info"><div>' +
      '<div class="store-name" style="color:' + tierColor + '">' + esc(a.lot.name) +
      ' <span class="dim">[' + (a.lot.kind === 'part' ? 'SHIP PART' : 'WEAPON MOD') +
      ' · ' + esc(a.lot.tier.toUpperCase()) + ']</span></div>' +
      '<div class="store-desc">' + esc(a.lot.desc) +
      '<br>⏱ ' + fmtTime(left) + ' left · Current bid <b>' + fmt(a.currentBid) + 'c</b>' +
      ' · Leader: <b>' + esc(leaderLabel) + '</b></div>' +
      recentBidsHTML(a) +
      '</div></div></div>';
    var p = SF.Player;
    var canBid = a.leader !== 'player' && p.credits >= next;
    html += '<div class="store-row"><div class="store-info"><div>' +
      '<div class="store-desc">Place the next bid. The hammer price is deducted only ' +
      'if you win — losing costs nothing.</div></div></div>' +
      '<button id="bm-bid-btn" class="btn store-btn"' + (canBid ? '' : ' disabled') + '>' +
      'BID ' + fmt(next) + 'c</button></div>';
    adiv.innerHTML = html;
    var bb = document.getElementById('bm-bid-btn');
    if (bb && canBid) {
      bb.addEventListener('click', function () {
        var r = placeBid();
        if (!r.ok && r.reason === 'funds') aucToast('Not enough credits for that bid.');
        renderAuction(adiv, site);
      });
    }
  }

  function startPanelTimer(site) {
    stopPanelTimer();
    panelTimer = setInterval(function () {
      catchUp();
      var el = document.getElementById('overlay-blackmarket');
      var ad = document.getElementById('bm-auction');
      if (el && !el.classList.contains('hidden') && ad) renderAuction(ad, site);
    }, 1000);
  }

  function stopPanelTimer() {
    if (panelTimer) { clearInterval(panelTimer); panelTimer = null; }
  }

  BlackMarket.auction = {
    AUCTION_MS: AUCTION_MS,
    NPC_BID_MS: NPC_BID_MS,
    /* Test/debug hooks (used by smoke.mjs). start() replaces the live lot —
     * production code never calls it; the rotation is self-sustaining. */
    state: function () { return publicState(); },
    start: function (opts) { startAuction(opts); return publicState(); },
    placeBid: placeBid,
    nextBid: function () { return (auction && !auction.resolved) ? auction.currentBid + minInc(auction) : null; },
    forceNpcBid: function () {
      var a = auction;
      if (!a || a.resolved) return false;
      npcBid(a);
      return true;
    },
    catchUp: function (now) { catchUp(now); },
    forceExpire: function () {
      if (auction && !auction.resolved) { auction.endsAt = Date.now(); catchUp(); }
    },
    lastResult: function () { return lastResult; }
  };

  SF.BlackMarket = BlackMarket;

  /* blackmarket-papers: hook the customs scan (SF.Customs.onDock) at runtime —
   * blackmarket.js loads before js/station.js, so install after scripts settle. */
  installScanHook();
})();
/* ============================================================
 * arena-announcer-voice-wiring-retry (2026-10-21): SF.AuctionVoice
 *
 * Wires voice-pack-4's auctioneer lines into the black-market auction
 * house (ids + durations per phases/voice-pack-4/VOICE-MANIFEST-4.md,
 * transcripts from phases/voice-pack-4/gen/lines.csv):
 *  - startAuction: 'auction_07' (new lot posted, blue tier or better)
 *  - npcBid: 'auction_02' (we have a bid); NPC outbidding the player:
 *    'auction_05' (outbid)
 *  - placeBid (player bids): 'auction_02' (we have a bid)
 *  - catchUp: last-30s warning -> 'auction_08'; last-10s -> 'auction_03'
 *    (each once per lot; runtime flags on the lot object, save-neutral)
 *  - resolve: player wins -> 'auction_04' (sold); NPC wins -> 'auction_05'
 *    (outbid); no bids -> 'auction_06' (withdrawn); player-unpaid: silent
 *    (no transcript matches the forfeit case)
 *
 * Playback: guarded SF.Audio.voice(id) + subtitle caption on this
 * phase's OWN element (#sf-auction-voice-caption, data-sf-voice-caption).
 * Never throws. Save-neutral: no persisted state, no SF.SAVE_VERSION bump.
 *
 * Public surface: SF.AuctionVoice { play, ids }.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.__auctionVoiceWiring) return; // no double install
  SF.__auctionVoiceWiring = true;

  var SPK = 'AUCTIONEER', COLOR = '#ff9f2e';
  // id -> {spk, color, dur (s from VOICE-MANIFEST-4.md), text (from gen/lines.csv)}
  var LINES = {
    auction_01: { spk: SPK, color: COLOR, dur: 24.8, text: 'Lot is open! Bidding is open! Who will start us at the asking price?' },
    auction_02: { spk: SPK, color: COLOR, dur: 22.1, text: 'We have a bid! Do I hear more? Do I hear more? Going once!' },
    auction_03: { spk: SPK, color: COLOR, dur: 30.5, text: 'Going twice! Last call! No regrets in the black market, only bad decisions!' },
    auction_04: { spk: SPK, color: COLOR, dur: 25.8, text: 'Sold! To the captain in the back! Hammer down, credits out, part is yours!' },
    auction_05: { spk: SPK, color: COLOR, dur: 27.7, text: 'Outbid! Coldwallet Ral takes it again. Your loss, captain. Your loss!' },
    auction_06: { spk: SPK, color: COLOR, dur: 32.4, text: 'No bids? No takers? Lot is withdrawn. The underworld never begs. Next lot!' },
    auction_07: { spk: SPK, color: COLOR, dur: 30.4, text: 'New lot posted! Blue tier or better, fresh off a wreck somebody else paid for. Bid!' },
    auction_08: { spk: SPK, color: COLOR, dur: 25.4, text: 'Timer is running! Twenty seconds of glory, then the hammer decides your fate!' }
  };
  var IDS = [];
  for (var k in LINES) if (LINES.hasOwnProperty(k)) IDS.push(k);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var capTimer = null;
  function caption(id) {
    var L = LINES[id];
    if (!L || typeof document === 'undefined') return;
    var el = document.getElementById('sf-auction-voice-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sf-auction-voice-caption';
      el.setAttribute('data-sf-voice-caption', 'auction');
      el.style.cssText = 'position:fixed;left:50%;bottom:18%;transform:translateX(-50%);' +
        'max-width:82%;padding:8px 16px;background:rgba(10,6,2,0.85);' +
        'border:1px solid #ff9f2e;border-radius:8px;color:#fff;' +
        'font:14px/1.35 sans-serif;text-align:center;pointer-events:none;z-index:9000;display:none;';
      if (!document.body) return;
      document.body.appendChild(el);
    }
    el.setAttribute('data-sf-voice-line', id);
    el.innerHTML = '<span style="color:' + L.color + ';font-weight:bold">' +
      esc(L.spk) + '</span><br>' + esc(L.text);
    el.style.display = 'block';
    if (capTimer) { try { clearTimeout(capTimer); } catch (e) {} }
    var ms = Math.round((L.dur || 3) * 1000);
    capTimer = setTimeout(function () { try { el.style.display = 'none'; } catch (e) {} }, ms);
  }

  /* Guarded voice call: audio is a bonus, captions always show. */
  function play(id) {
    if (!LINES[id]) return false;
    if (window.SF && SF.Audio && SF.Audio.voice) {
      try { SF.Audio.voice(id); } catch (e) {}
    }
    try { caption(id); } catch (e) {}
    return true;
  }

  SF.AuctionVoice = { play: play, ids: IDS };
})();

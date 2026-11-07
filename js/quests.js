/* ============================================================
 * STARFALL — Phase 4: Quest Board + Companions
 *
 * SF.Quests: kill/mining/supply/escort quest offers re-rolled on each
 * dock, quest log UI (Q key + HUD button), turn-in at the offering
 * station, escort ambush spawns on undock.
 *
 * SF.Companions: 6 hireable companions with dialogue trees, wingman
 * combat AI following the player (cap 2 active). Wingmen are
 * intentionally untargetable by enemies (design simplification).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  /* ============================ QUESTS ============================ */

  var TYPES = {
    kill:   { label: '☠ Kill Contract',   desc: 'Destroy {n} hostiles anywhere.',             st: 'hostiles' },
    mining: { label: '⛏ Mining Claim',    desc: 'Deliver {n} ore to this station.',            st: 'ore' },
    supply: { label: '📦 Supply Run',     desc: 'Sell {n} salvage parts at this station.',    st: 'parts' },
    escort: { label: '🛡 Escort Duty',    desc: 'Undock and survive the ambush they warned you about.', st: 'ambush' }
  };

  function qs() { return SF.Player.questState; }

  // enemies.js exposes either an array or an accessor; handle both.
  function enemyList() {
    var l = SF.Enemies.list;
    return (typeof l === 'function') ? l() : l;
  }

  /* weapons-arsenal: weapon reward pools by contract type/difficulty */
  var WEAPON_REWARDS = {
    kill1: ['shard', 'coilgun'],
    kill2: ['repeater', 'flak'],
    kill3: ['beam', 'torpedo', 'sniper'],
    escort: ['emp', 'minelayer', 'lance']
  };

  function rollOffer() {
    var keys = ['kill', 'mining', 'supply', 'escort'];
    var type = keys[rint(0, 3)];
    var diff = rint(0, 2);
    var baseN = type === 'kill' ? [3, 5, 8][diff] : type === 'mining' ? [10, 18, 30][diff]
              : type === 'supply' ? [4, 7, 12][diff] : [1, 1, 2][diff];
    var reward = rint(120, 200) + diff * 180 + (type === 'kill' ? baseN * 40 : 0);
    var factionId = ['compact', 'drifters', 'ember'][rint(0, 2)];
    // weapons-arsenal: kill/escort contracts carry a weapon reward
    var weapon = null;
    if (type === 'kill' && diff >= 1) {
      var kp = WEAPON_REWARDS['kill' + diff];
      weapon = kp[rint(0, kp.length - 1)];
    } else if (type === 'escort') {
      var ep = WEAPON_REWARDS.escort;
      weapon = ep[rint(0, ep.length - 1)];
    }
    return {
      id: 'q' + Date.now().toString(36) + rint(100, 999),
      type: type, diff: diff, n: baseN, reward: reward,
      weapon: weapon,
      faction: factionId,
      station: SF.Game.systemId + ':' + SF.Game.dockedAt,
      progress: 0, state: 'offer'
    };
  }

  function typeLabel(q) { return TYPES[q.type].label; }
  function typeDesc(q) {
    return TYPES[q.type].desc.replace('{n}', q.n) +
      (q.type === 'ambush' ? '' : '');
  }

  var Quests = {

    /* re-rolled each dock */
    rollOffers: function () {
      var st = qs();
      st.offers = [];
      for (var i = 0; i < 3; i++) st.offers.push(rollOffer());
      st.offers.forEach(function (o) { o.state = 'offer'; });
    },

    offers: function () { return qs().offers || []; },
    active: function () {
      return (qs().active || []).filter(function (q) { return q.state === 'active'; });
    },

    accept: function (offerId) {
      var st = qs();
      var i = st.offers.findIndex(function (o) { return o.id === offerId; });
      if (i < 0) return false;
      var q = st.offers.splice(i, 1)[0];
      q.state = 'active';
      q.progress = 0;
      st.active.push(q);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Contract accepted: ' + typeLabel(q));
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      return true;
    },

    abandon: function (questId) {
      var st = qs();
      var i = (st.active || []).findIndex(function (q) { return q.id === questId; });
      if (i >= 0) { st.active.splice(i, 1);
        if (SF.Audio && SF.Audio.questFail) SF.Audio.questFail();
        // crew-depth-wiring: abandoned contract -> crew morale loss
        if (window.SF && SF.Crew && SF.Player) SF.Crew.onMissionLost(SF.Player.ships[SF.Player.activeShip]);
        return true; }
      return false;
    },

    /* ---- progress hooks ---- */
    onKill: function (e) {
      this.active().forEach(function (q) {
        if (q.type === 'kill' && q.state === 'active' && !e.faction) {
          q.progress++;
          if (SF.HUD && SF.HUD.toast && q.progress === q.n)
            SF.HUD.toast('Kill contract complete — return to ' + q.station.split(':')[1]);
        }
      });
    },

    onOreMined: function (n) {
      this.active().forEach(function (q) {
        if (q.type === 'mining' && q.state === 'active') {
          q.progress = Math.min(q.n, q.progress + n);
        }
      });
    },

    onUndock: function () {
      // escort quests: ambush spawns when leaving the offering station
      var st = qs();
      st.pendingAmbush = null;
      this.active().forEach(function (q) {
        if (q.type === 'escort' && q.state === 'active' && q.station === SF.Game.systemId + ':' + SF.Game.dockedAt) {
          q.state = 'ambush';
          st.pendingAmbush = q.id;
          var mul = SF.SYSTEM_BY_ID[SF.Game.systemId] ?
            SF.SYSTEM_BY_ID[SF.Game.systemId].enemyMul : 1;
          for (var i = 0; i < q.n + 2; i++) {
            var a = Math.random() * Math.PI * 2;
            SF.Enemies.spawn('raider', SF.Player.x + Math.cos(a) * 500,
                             SF.Player.y + Math.sin(a) * 500, mul,
                             { questOid: true });
          }
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('⚠ Escort ambush! Hostiles inbound!');
          if (SF.Audio && SF.Audio.alert) SF.Audio.alert();
        }
      });
    },

    onAmbushCleared: function () {
      var st = qs();
      if (!st.pendingAmbush) return;
      var ambushers = enemyList().filter(function (e) { return e.questOid; });
      if (ambushers.length === 0) {
        var q = (st.active || []).filter(function (x) { return x.id === st.pendingAmbush; })[0];
        if (q) {
          q.state = 'active'; q.progress = q.n;
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Escort duty done — collect your pay at the station.');
        }
        st.pendingAmbush = null;
      }
    },

    /* ---- turn-in ---- */
    turnIn: function (questId) {
      var st = qs();
      var q = (st.active || []).filter(function (x) { return x.id === questId; })[0];
      if (!q) return false;
      // must be docked at the offering station — check BEFORE touching cargo
      if (SF.Game.systemId + ':' + SF.Game.dockedAt !== q.station) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Return to ' + q.station.split(':')[1] + ' to collect.');
        return false;
      }
      var ready = false;
      var p = SF.Player;
      if (q.type === 'kill' || q.type === 'escort') ready = q.progress >= q.n;
      else if (q.type === 'mining') { ready = p.ore >= q.n; if (ready) p.ore -= q.n; }
      else if (q.type === 'supply') {
        var have = Object.keys(p.partInventory || {}).reduce(function (a, k) { return a + p.partInventory[k]; }, 0);
        ready = have >= q.n;
        if (ready) {
          var need = q.n;
          Object.keys(p.partInventory).forEach(function (k) {
            var take = Math.min(p.partInventory[k], need);
            p.partInventory[k] -= take; need -= take;
            if (p.partInventory[k] <= 0) delete p.partInventory[k];
          });
        }
      }
      if (!ready) return false;
      p.credits += q.reward;
      // weapons-arsenal: weapon rewards on kill/escort contracts (dup → half-price)
      var wtxt = '';
      if (q.weapon && SF.WEAPON_BY_ID[q.weapon]) {
        var wd = SF.WEAPON_BY_ID[q.weapon];
        if (!p.hasWeapon(q.weapon)) {
          p.addWeapon(q.weapon);
          wtxt = ', ⚔ ' + wd.name + ' acquired';
        } else {
          var half = Math.floor(wd.price / 2);
          p.credits += half;
          wtxt = ', duplicate ⚔ ' + wd.name + ' → +' + half + 'c';
        }
      }
      if (SF.Factions) SF.Factions.shift(q.faction, 5 + q.diff * 2);
      var i = st.active.indexOf(q);
      st.active.splice(i, 1);
      st.done = (st.done || 0) + 1;
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('✔ Contract paid: +' + q.reward + 'cr' + wtxt + ', ' +
        SF.FACTION_BY_ID[q.faction].name + ' +' + (5 + q.diff * 2));
      // planets-facilities: completed contracts make the wire
      if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 Contract complete: a ' +
        SF.FACTION_BY_ID[q.faction].name + ' ' + q.type + ' job paid out ' + q.reward + 'cr.');
      if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      // crew-depth-wiring: contract paid out -> crew morale win + contract xp
      if (window.SF && SF.Crew && SF.Player) {
        var cdSh = SF.Player.ships[SF.Player.activeShip];
        SF.Crew.onMissionWon(cdSh);
        SF.Crew.onContract(cdSh);
      }
      return true;
    },

    /* ---- UI ---- */
    renderBoard: function (body) {
      var st = qs();
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'QUEST BOARD'; body.appendChild(h);
      var self = this;
      this.offers().forEach(function (o) {
        var row = document.createElement('div');
        row.className = 'store-row';
        var fd = SF.FACTION_BY_ID[o.faction];
        var wline = (o.weapon && SF.WEAPON_BY_ID[o.weapon])
          ? '<br>⚔ Bonus: <span style="color:' + SF.WEAPON_BY_ID[o.weapon].color + '">' +
            SF.WEAPON_BY_ID[o.weapon].name + '</span>' : '';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">' + typeLabel(o) + '</div>' +
          '<div class="store-desc">' + typeDesc(o) +
          '<br>Sponsor: <span style="color:' + fd.color + '">' + fd.name + '</span>' +
          ' · Reward: <b>' + o.reward + 'cr</b>' + wline + '</div></div></div>' +
          '<button class="btn store-btn">ACCEPT</button>';
        row.querySelector('button').addEventListener('click', function () {
          if (self.accept(o.id)) SF.Station.renderStore();
        });
        body.appendChild(row);
      });
      // active quests with progress + turn-in buttons
      this.active().forEach(function (q) {
        var done = (q.type === 'kill' || q.type === 'escort') ? q.progress >= q.n
          : (q.type === 'mining' ? SF.Player.ore >= q.n : null);
        var row = document.createElement('div');
        row.className = 'store-row';
        var qwline = (q.weapon && SF.WEAPON_BY_ID[q.weapon])
          ? '<br>⚔ Bonus: <span style="color:' + SF.WEAPON_BY_ID[q.weapon].color + '">' +
            SF.WEAPON_BY_ID[q.weapon].name + '</span>' : '';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">▶ ' + (q.name || typeLabel(q)) + '</div>' +
          '<div class="store-desc">' + (q.brief || typeDesc(q)) +
          '<br>Progress: <b>' + q.progress + '/' + q.n + '</b>' + qwline +
          ' · Turn in at: <b>' + q.station.split(':')[1] + '</b></div></div></div>' +
          '<button class="btn store-btn" ' + (done ? '' : 'disabled') + '>TURN IN</button>';
        row.querySelector('button').addEventListener('click', function () {
          self.turnIn(q.id);
        });
        body.appendChild(row);
      });
    },

    openLog: function () {
      var body = $('quests-body');
      body.innerHTML = '';
      var self = this;
      var act = this.active();
      if (!act.length) {
        var d = document.createElement('div');
        d.className = 'dlg-text';
        d.textContent = 'No active contracts. Check a station quest board.';
        body.appendChild(d);
      }
      act.forEach(function (q) {
        var row = document.createElement('div');
        row.className = 'store-row';
        var atStation = (SF.Game.systemId + ':' + SF.Game.dockedAt) === q.station;
        var ready = q.progress >= q.n || q.type === 'mining' || q.type === 'supply';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">' + (q.name || typeLabel(q)) + '</div>' +
          '<div class="store-desc">' + (q.brief || typeDesc(q)) + '<br>Progress: <b>' + q.progress + '/' + q.n +
          '</b> · Turn in: <b>' + q.station.split(':')[1] + '</b></div></div></div>' +
          '<button class="btn store-btn"' + (ready && atStation ? '' : 'disabled') + '>TURN IN</button>';
        (function (qq) {
          row.querySelector('button').addEventListener('click', function () {
            self.turnIn(qq.id); self.openLog();
          });
        })(q);
        body.appendChild(row);
      });
      SF.Game.showOverlay('overlay-quests');
    },

    closeLog: function () { SF.Game.hideOverlay('overlay-quests'); }
  };

  SF.Quests = Quests;

  /* ============================ COMPANIONS ============================ */

  var TIERS = { common: '#b8c0cc', veteran: '#3ddc5f', elite: '#4da3ff', ace: '#c56bff', legend: '#ff9f2e' };

  var COMPS = [
    { id: 'rook', name: 'Rook', portrait: '🧑‍🚀', tier: 'common', cost: 250, dps: 6,
      intro: 'Ex-freighter gunner. Steady hands, cheaper than a hull plate.',
      lines: { hire: 'Smart money. I\\u2019ll watch your six.',
               no: 'No hard feelings. The Drift\\u2019s always hiring.' } },
    { id: 'vex', name: 'Vex', portrait: '👩‍✈️', tier: 'veteran', cost: 500, dps: 10,
      intro: 'Drifter scout with a fast trigger and faster mouth.',
      lines: { hire: 'Try not to get me killed, cap\\u2019n.',
               no: 'Your loss. I fly mean.' } },
    { id: 'bram', name: 'Bram', portrait: '🧙', tier: 'veteran', cost: 650, dps: 12,
      intro: 'Old Compact navy. Reads a scope like scripture.',
      lines: { hire: 'For the Compact\\u2019s memory, then.',
               no: 'The lanes are safer with me, but suit yourself.' } },
    { id: 'juno', name: 'Juno', portrait: '👨‍🚀', tier: 'elite', cost: 1200, dps: 18,
      intro: 'Wing-leader out of the Ember war. Expensive. Worth it.',
      lines: { hire: 'You won\\u2019t regret this.',
               no: 'War doesn\\u2019t wait, captain.' } },
    { id: 'nyx', name: 'Nyx', portrait: '🧛', tier: 'ace', cost: 2500, dps: 26,
      intro: 'Nobody knows who Nyx flew for before. Nobody asks twice.',
      lines: { hire: 'Payment up front. Loyalty after.',
               no: 'Shadows don\\u2019t beg.' } },
    { id: 'saskia', name: 'Saskia', portrait: '👩‍🚀', tier: 'legend', cost: 4000, dps: 36,
      intro: 'The "Storm of Ember Row". Legends charge legend rates.',
      lines: { hire: 'Fly close. Watch me work.',
               no: 'Ha! Come find me when you\\u2019re serious.' } },
    /* secrets-easter-eggs: hidden companion. Never in the hire UI (hidden);
     * recruitable only via the lifepod (Pale Lantern ghost signal). */
    { id: 'hushed', name: 'The Hushed One', portrait: '👻', tier: 'legend', cost: 0, dps: 44,
      hidden: true,
      intro: 'Found in a lifepod near the Pale Lantern. Speaks in static. Flies like a ghost.',
      lines: { hire: '\u2026static\u2026 acknowledged, captain.',
               no: '\u2026the static fades. They were never here.' } }
  ];
  var COMP_BY_ID = {};
  COMPS.forEach(function (c) { COMP_BY_ID[c.id] = c; });

  function cs() { return SF.Player.companionState; }
  function MAX_ACTIVE() { return 2; }

  /* twelve-hour-wave3 (B2): Leadership wingman-damage seam (the tree's
   * wing-tactics nodes were unwired like the hire discount — same fix
   * wave). Guarded: missing skills = 1.0. Formation/loyalty multipliers
   * stack multiplicatively, unchanged. */
  function wingmanSkillMul() {
    try {
      if (window.SF && SF.Skills && SF.Skills.wingmanMul) return SF.Skills.wingmanMul();
    } catch (e) {}
    return 1;
  }

  var Companions = {
    defs: COMPS,
    byId: COMP_BY_ID,

    hired: function () { return cs().hired || []; },
    active: function () { return cs().active || []; },

    isHired: function (id) { return this.hired().indexOf(id) >= 0; },

    /* twelve-hour-wave3 (B2): Leadership hire-discount seam — the ONE
     * price for a companion. hire(), the hire-row button, and the hire
     * dialogue all read this, so the displayed price and the charged
     * price can never disagree. Hidden companions cost 0, so grant()
     * (which bypasses cost) is untouched. Guarded: missing skills = 1.0. */
    effCost: function (id) {
      var def = COMP_BY_ID[id];
      if (!def) return 0;
      var m = 1;
      try {
        if (window.SF && SF.Skills && SF.Skills.hireCostMul) m = SF.Skills.hireCostMul();
      } catch (e) {}
      return Math.max(0, Math.ceil(def.cost * m));
    },

    hire: function (id) {
      var def = COMP_BY_ID[id];
      if (!def || this.isHired(id)) return false;
      var cost = this.effCost(id);
      if (SF.Player.credits < cost) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Not enough credits.');
        return false;
      }
      SF.Player.credits -= cost;
      cs().hired.push(id);
      // auto-activate up to the cap
      var act = this.active();
      if (act.length < MAX_ACTIVE()) act.push({ id: id, x: SF.Player.x, y: SF.Player.y });
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast(def.name + ' joined your wing!');
      if (SF.Audio && SF.Audio.hire) SF.Audio.hire();
      return true;
    },

    /* secrets-easter-eggs: free recruitment of a hidden companion
     * (bypasses cost and the hire UI). */
    grant: function (id) {
      var def = COMP_BY_ID[id];
      if (!def || this.isHired(id)) return false;
      cs().hired.push(id);
      var act = this.active();
      if (act.length < MAX_ACTIVE()) act.push({ id: id, x: SF.Player.x, y: SF.Player.y });
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast(def.name + ' joined your wing!');
      if (SF.Audio && SF.Audio.lifepod) SF.Audio.lifepod();
      return true;
    },

    dismiss: function (id) {
      var h = cs().hired, a = cs().active;
      var i = h.indexOf(id); if (i >= 0) h.splice(i, 1);
      for (var j = a.length - 1; j >= 0; j--) if (a[j].id === id) a.splice(j, 1);
    },

    toggleActive: function (id) {
      var a = cs().active;
      for (var i = 0; i < a.length; i++) {
        if (a[i].id === id) { a.splice(i, 1); return; }
      }
      if (a.length >= MAX_ACTIVE()) {
        if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Wing full (max ' + MAX_ACTIVE() + ').');
        return;
      }
      a.push({ id: id, x: SF.Player.x, y: SF.Player.y });
    },

    /* ---- wingman combat AI: follows player, shoots nearest enemy.
     * Wingmen are UNTARGETABLE by design (enemies never aim at them). */
    update: function (dt) {
      var p = SF.Player, self = this;
      this.active().forEach(function (w) {
        var def = COMP_BY_ID[w.id];
        // formation slot: behind-left / behind-right
        var idx = self.active().indexOf(w);
        var back = 70, side = idx === 0 ? -60 : 60;
        var tx = p.x - Math.cos(p.angle) * back - Math.sin(p.angle) * side;
        var ty = p.y - Math.sin(p.angle) * back + Math.cos(p.angle) * side;
        var dx = tx - w.x, dy = ty - w.y;
        var d = Math.hypot(dx, dy) || 1;
        var sp = clamp(d * 4, 60, 420);
        w.x += dx / d * sp * dt;
        w.y += dy / d * sp * dt;
        // fire at nearest enemy within 520
        var enemies = enemyList();
        var best = null, bd = 520;
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          var ed = Math.hypot(e.x - w.x, e.y - w.y);
          if (ed < bd) { bd = ed; best = e; }
        }
        w.cool = (w.cool || 0) - dt;
        if (best && w.cool <= 0) {
          w.cool = 0.55;
          var ang = Math.atan2(best.y - w.y, best.x - w.x);
          SF.Projectiles.spawn(w.x, w.y, ang, 520, def.dps * 0.9 * Companions.loyaltyDmgMul(w.id) * wingmanSkillMul(), true, '#9fd8ff');
        }
      });
      Companions.loyaltyRegenTick(dt);
    },

    draw: function (ctx) {
      var self = this;
      this.active().forEach(function (w) {
        var def = COMP_BY_ID[w.id];
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(Math.atan2(SF.Player.y - w.y, SF.Player.x - w.x));
        /* twelve-hour-wave4 readability: wingmen were a bare 10px
         * procedural dart with a 1.5px stroke — a dark halo disc plus
         * a heavier stroke lifts them off bright backgrounds without
         * changing their size, role, or untargetable status. */
        ctx.fillStyle = 'rgba(4,8,18,0.35)';
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = TIERS[def.tier] || '#fff';
        ctx.strokeStyle = '#0b1020'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, 0); ctx.lineTo(-7, 7); ctx.lineTo(-4, 0); ctx.lineTo(-7, -7);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    },

    /* ---- station hire UI (dialogue trees) ---- */
    renderHire: function (body) {
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'HIRE WINGMEN'; body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'store-desc';
      note.style.margin = '4px 0 8px';
      note.textContent = 'Wingmen fly with you (max ' + MAX_ACTIVE() + ' active). They fight beside you and can\\u2019t be targeted.';
      body.appendChild(note);
      var self = this;
      COMPS.forEach(function (c) {
        if (c.hidden) return; // secrets-easter-eggs: hidden companions never appear in the hire UI
        var hired = self.isHired(c.id);
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name"><span class="comp-portrait">' + c.portrait + '</span>' +
          c.name + ' <span class="tier-dot" style="color:' + TIERS[c.tier] + '">● ' + c.tier.toUpperCase() + '</span></div>' +
          '<div class="store-desc">' + c.intro + (hired ? '<br><b>Hired.</b> ' +
            SF.Companions.loyaltyStars(c.id) + '<br>Tap to ' +
            (self.active().some(function (w) { return w.id === c.id; }) ? 'bench' : 'activate') + '.' : '') + '</div></div></div>' +
          '<button class="btn store-btn">' + (hired ? 'WING' : self.effCost(c.id) + 'cr' +
            (self.effCost(c.id) < c.cost ? ' <span style="color:#3ddc5f">(skill −' +
              Math.round(100 * (1 - self.effCost(c.id) / c.cost)) + '%)</span>' : '')) + '</button>';
        row.querySelector('button').addEventListener('click', function () {
          if (!self.isHired(c.id)) {
            // dialogue tree
            SF.NPCs.dialogue({
              title: c.name + ' ' + c.portrait,
              text: '\\u201C' + c.intro + '\\u201D\\n\\n' +
                (SF.Player.credits >= self.effCost(c.id)
                  ? 'The captain\\u2019s got the credits. Sign me on?'
                  : 'Come back when your purse is heavier, captain.'),
              choices: (SF.Player.credits >= self.effCost(c.id) ? [{
                label: 'Hire for ' + self.effCost(c.id) + 'cr',
                run: function () {
                  self.hire(c.id);
                  SF.NPCs.dialogue({ title: c.name, text: '\\u201C' + c.lines.hire + '\\u201D', choices: [] });
                  SF.Station.renderStore();
                }
              }] : []).concat([{
                label: 'Walk away',
                run: function () {
                  SF.NPCs.dialogue({ title: c.name, text: '\\u201C' + c.lines.no + '\\u201D', choices: [] });
                }
              }])
            });
          } else {
            self.toggleActive(c.id);
            SF.Station.renderStore();
          }
        });
        body.appendChild(row);
      });
    }
  };

  SF.Companions = Companions;
})();
/* ============================================================
 * companion-quests phase: personal quest chains for the 6 hireable
 * companions (3 stages each: kill/fetch/escort), offered through
 * Recruiter Vane's dialogue. Stage turn-ins raise that companion's
 * loyalty, which boosts wingman damage (+3/+6/+10%) and grants a
 * small passive hull regen — the wingman's engineer patches you up.
 *
 * Save-neutral: loyalty + chain progress live inside the existing
 * questState.active quests (cqId/stage/name/brief keys) and
 * companionState (loyalty + cqProg keys). No save version bump.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function qs() { return SF.Player.questState; }
  function cs() { return SF.Player.companionState; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* BALANCE.md spirit: small, ~+3/+6/+10% per loyalty tier */
  var LOYALTY_DMG = [1, 1.03, 1.06, 1.10];
  var LOYALTY_REGEN = [0, 0.2, 0.45, 0.8]; /* hull/sec, per loyal wingman */

  /* stage: {type, n, reward, faction, brief, title}
   * types reuse quest-board mechanics (kill/mining/supply/escort);
   * escort quests spawn their ambush via the base onUndock hook. */
  var CHAINS = {
    rook: [
      { type: 'kill',   n: 4, reward: 160, faction: 'drifters', title: 'Rook: Old Debts I',
        brief: 'Rook: \u201CPirates raided my old freighter run. Thin them out, anywhere.\u201D' },
      { type: 'supply', n: 6, reward: 260, faction: 'drifters', title: 'Rook: Spare Parts II',
        brief: 'Rook: \u201CMy rig eats salvage. Scrounge 6 salvage parts for me.\u201D' },
      { type: 'escort', n: 1, reward: 420, faction: 'drifters', title: 'Rook: One Last Run III',
        brief: 'Rook: \u201COne more pass down the old lane. Undock and fly cover.\u201D' }
    ],
    vex: [
      { type: 'kill',   n: 3, reward: 140, faction: 'drifters', title: 'Vex: Loose Ends I',
        brief: 'Vex: \u201CThree pirates jumped me in the Drift. Make them regret it.\u201D' },
      { type: 'escort', n: 1, reward: 320, faction: 'drifters', title: 'Vex: Hot Cargo II',
        brief: 'Vex: \u201CI\u2019m hauling something the raiders want. Undock and cover me.\u201D' },
      { type: 'kill',   n: 8, reward: 520, faction: 'drifters', title: 'Vex: The Pack III',
        brief: 'Vex: \u201CTheir whole pack nests past Ember Row. Burn it down.\u201D' }
    ],
    bram: [
      { type: 'mining', n: 12, reward: 150, faction: 'compact', title: 'Bram: Quiet Work I',
        brief: 'Bram: \u201CNavy days are done. Bring me 12 ore \u2014 honest work.\u201D' },
      { type: 'kill',   n: 5, reward: 300, faction: 'compact', title: 'Bram: For the Compact II',
        brief: 'Bram: \u201CPirates press a Compact lane. Answer it, captain.\u201D' },
      { type: 'supply', n: 8, reward: 380, faction: 'compact', title: 'Bram: Refit III',
        brief: 'Bram: \u201CMy old navy skiff needs 8 salvage parts. Help an old man.\u201D' }
    ],
    juno: [
      { type: 'escort', n: 1, reward: 380, faction: 'ember', title: 'Juno: Wing Protocol I',
        brief: 'Juno: \u201CFly my wing through the Drift run. Undock \u2014 watch the flanks.\u201D' },
      { type: 'kill',   n: 6, reward: 460, faction: 'ember', title: 'Juno: Ember Skirmish II',
        brief: 'Juno: \u201CEmber raiders probe our flank. Meet them head-on.\u201D' },
      { type: 'kill',   n: 10, reward: 700, faction: 'ember', title: 'Juno: The Decisive III',
        brief: 'Juno: \u201CTheir carrier group is massing. Break it before it breaks us.\u201D' }
    ],
    nyx: [
      { type: 'kill',   n: 5, reward: 420, faction: 'drifters', title: 'Nyx: Static I',
        brief: 'Nyx: \u201C\u2026they listen through the static. Silence five of them.\u201D' },
      { type: 'mining', n: 20, reward: 480, faction: 'drifters', title: 'Nyx: Static II',
        brief: 'Nyx: \u201C\u2026the hull drinks ore. Feed it twenty.\u201D' },
      { type: 'escort', n: 2, reward: 800, faction: 'drifters', title: 'Nyx: Static III',
        brief: 'Nyx: \u201C\u2026two shadows tail me past Ember Row. Undock \u2014 burn them bright.\u201D' }
    ],
    saskia: [
      { type: 'kill',   n: 6, reward: 500, faction: 'ember', title: 'Saskia: Storm Warning I',
        brief: 'Saskia: \u201CSix raiders, Ember Row. Show them the Storm.\u201D' },
      { type: 'supply', n: 10, reward: 560, faction: 'ember', title: 'Saskia: Storm\u2019s Due II',
        brief: 'Saskia: \u201CMy legend needs upkeep \u2014 10 salvage parts.\u201D' },
      { type: 'kill',   n: 12, reward: 950, faction: 'ember', title: 'Saskia: The Storm III',
        brief: 'Saskia: \u201CThe whole Ember Row pack. Bring me their silence.\u201D' }
    ]
  };

  var CQ = {
    chains: CHAINS,

    /* stages completed for a companion (0..3) */
    stageOf: function (id) { return (cs().cqProg || {})[id] || 0; },

    activeFor: function (id) {
      return (qs().active || []).filter(function (q) { return q.cqId === id; })[0] || null;
    },

    chainDone: function (id) { return this.stageOf(id) >= 3; },

    loyaltyOf: function (id) { return clamp((cs().loyalty || {})[id] || 0, 0, 3); },

    dmgMul: function (id) { return LOYALTY_DMG[this.loyaltyOf(id)]; },

    regenOf: function (id) { return LOYALTY_REGEN[this.loyaltyOf(id)]; },

    canOffer: function (id) {
      return !!(SF.Companions && SF.Companions.isHired(id)) &&
        !this.chainDone(id) && !this.activeFor(id);
    },

    offerStage: function (id) {
      if (!this.canOffer(id)) return false;
      var stage = this.stageOf(id);
      var def = CHAINS[id][stage];
      if (!def) return false;
      var q = {
        id: 'cq-' + id + '-s' + stage + '-' + Date.now().toString(36),
        type: def.type, n: def.n, diff: stage, reward: def.reward,
        faction: def.faction, weapon: null,
        station: SF.Game.systemId + ':' + SF.Game.dockedAt,
        progress: 0, state: 'active',
        cqId: id, stage: stage, name: def.title, brief: def.brief
      };
      qs().active.push(q);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Personal contract: ' + def.title);
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* called (via the turnIn wrap below) after a successful companion turn-in */
    onTurnedIn: function (q) {
      var id = q.cqId, stage = q.stage;
      var c = cs();
      c.cqProg = c.cqProg || {};
      c.loyalty = c.loyalty || {};
      c.cqProg[id] = Math.max(c.cqProg[id] || 0, stage + 1);
      c.loyalty[id] = Math.min(3, stage + 1);
      var def = SF.Companions.byId[id];
      var name = def ? def.name : id;
      var pct = Math.round((LOYALTY_DMG[c.loyalty[id]] - 1) * 100);
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u2764 ' + name + ' loyalty ' + this._stars(c.loyalty[id]) +
          ' \u2014 wingman damage +' + pct + '%');
      if (window.SF && SF.News) SF.News.push('\uD83D\uDCF0 ' + name +
        ' flew a personal contract \u2014 loyalty rising in the wing.');
      if (SF.Save) SF.Save.save();
      /* companion dialogue — turn-ins happen docked, so the overlay is safe */
      var T = (window.SF && SF.NPCs && SF.NPCs.CQUEST_TEXT && SF.NPCs.CQUEST_TEXT[id]) || null;
      if (T && T[stage] && SF.Dialogue) {
        var done = c.cqProg[id] >= 3;
        SF.Dialogue.open({
          title: name + ' \u2014 ' + (done ? 'chain complete' : 'stage complete'),
          text: '\u201C' + T[stage].complete + '\u201D' +
            (done ? '\n\n\u2764 Loyalty maxed \u2014 +' + pct + '% wingman damage, hull patched faster.' : ''),
          choices: []
        });
      }
    },

    _stars: function (n) { return '\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606'.slice(0, 3 - n); }
  };

  SF.CompanionQuests = CQ;

  /* ---- loyalty combat integration ---- */
  SF.Companions.loyaltyDmgMul = function (id) { return CQ.dmgMul(id); };
  SF.Companions.loyaltyStars = function (id) {
    return '<span style="color:#ff7d9c">\u2764 ' + CQ._stars(CQ.loyaltyOf(id)) + '</span>';
  };
  /* called once per frame from Companions.update (patched in base code) */
  SF.Companions.loyaltyRegenTick = function (dt) {
    var sum = 0, i, w;
    var act = this.active();
    for (i = 0; i < act.length; i++) sum += CQ.regenOf(act[i].id);
    if (sum > 0 && SF.Game.state === 'PLAYING' && SF.Player.alive && SF.Player.hull > 0) {
      SF.Player.heal(sum * dt);
    }
  };

  /* ---- turnIn wrap: companion quests chain-stage + loyalty on payout.
   * chains under skills.js's own turnIn wrap (same pattern, no flag clash). */
  (function () {
    var orig = SF.Quests && SF.Quests.turnIn;
    if (!orig || orig.__cq) return;
    var w = function (questId) {
      var st = qs();
      var q = (st.active || []).filter(function (x) { return x.id === questId; })[0] || null;
      var ok = orig.apply(this, arguments);
      if (ok && q && q.cqId) CQ.onTurnedIn(q);
      return ok;
    };
    w.__cq = true;
    SF.Quests.turnIn = w;
  })();

  /* ---- BUG FIX (needed by this phase): SF.Quests.onAmbushCleared was dead
   * code — nothing called it, so escort contracts (quest-board or companion)
   * could never complete. Wrap Enemies.kill so clearing the last quest-marked
   * ambusher completes the ambush. Additive wrap only; no base edits. ---- */
  (function () {
    var orig = SF.Enemies && SF.Enemies.kill;
    if (!orig || orig.__cq) return;
    var w = function (e) {
      var r = orig.apply(this, arguments);
      try {
        if (window.SF && SF.Quests) {
          var l = SF.Enemies.list;
          var list = (typeof l === 'function') ? l() : l;
          var left = list.filter(function (x) { return x.questOid; });
          if (left.length === 0) SF.Quests.onAmbushCleared();
        }
      } catch (err) { /* never break kills */ }
      return r;
    };
    w.__cq = true;
    SF.Enemies.kill = w;
  })();
})();
/* ============================================================
 * quest-side-chains phase: 3 side quest chains on the quest board.
 *
 * (1) Hollow Echoes — 4-stage derelict salvage chain feeding the
 *     secrets/dungeon lore (drifters).
 * (2) Courier's Gamble — 4 timed deliveries across the 3 systems
 *     (compact). New 'deliver' quest type: turn in at a destination
 *     station before a wall-clock deadline or the run expires.
 * (3) Dead Man's Ledger — 4-stage bounty chain ending at the named
 *     elite "Morvane the Pale" (ember). New 'hunt' quest type: only
 *     the spawned elite counts; it spawns on first undock after
 *     accepting the stage.
 *
 * Offered via the quest board (wrapped renderBoard adds a SIDE
 * CHAINS section); chain progress shows in the quest log UI (base
 * openLog lists chain quests; deliveries get a live countdown and
 * destination in their brief). Chain stage advancement hooks into
 * the base turnIn via a wrap (flag __sq), chaining under the
 * companion-quests (__cq) and skills (__skills) wraps.
 *
 * Save-neutral: progress lives in questState.sqProg / sqDone and in
 * the active quest blob (sqChain/sqStage keys). No save version bump.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function qs() { return SF.Player.questState; }

  var SIDE_CHAINS = [
    { id: 'hollow-echoes', title: 'Hollow Echoes', faction: 'drifters',
      bonus: 500, bonusStanding: 8,
      stages: [
        { type: 'kill', n: 5, reward: 240, standing: 4,
          title: 'Hollow Echoes I: Sweep the Wreck',
          brief: '\u201CThe Pale Lantern\u2019s sister hulk drifted in-system. Clear 5 pirates off her bones.\u201D' },
        { type: 'supply', n: 8, reward: 340, standing: 4,
          title: 'Hollow Echoes II: Strip the Hulk',
          brief: '\u201CScavs won\u2019t touch the hulk. Haul 8 salvage parts off her yourself.\u201D' },
        { type: 'escort', n: 1, reward: 480, standing: 5,
          title: 'Hollow Echoes III: Cut the Reactor',
          brief: '\u201CA cutter crew is going in for the reactor. Undock and keep the raiders off them.\u201D' },
        { type: 'mining', n: 16, reward: 640, standing: 6,
          title: 'Hollow Echoes IV: Crack the Core',
          brief: '\u201CThe hulk\u2019s veins run rich. Mine 16 ore from the wreck\u2019s ribs.\u201D' }
      ] },
    { id: 'couriers-gamble', title: 'Courier\u2019s Gamble', faction: 'compact',
      bonus: 600, bonusStanding: 8,
      stages: [
        { type: 'deliver', n: 6, reward: 260, standing: 3,
          title: 'Courier\u2019s Gamble I: The First Run',
          brief: '\u201CSealed manifest to New Kestrel, Drift system. Don\u2019t be late.\u201D',
          dest: 'drift:New Kestrel', deadlineMs: 8 * 60 * 1000 },
        { type: 'deliver', n: 4, reward: 340, standing: 4,
          title: 'Courier\u2019s Gamble II: Shattered Route',
          brief: '\u201CThe Shatters, Drift. Hotter lane, tighter clock.\u201D',
          dest: 'drift:The Shatters', deadlineMs: 5 * 60 * 1000 },
        { type: 'deliver', n: 8, reward: 460, standing: 5,
          title: 'Courier\u2019s Gamble III: Ember Crossing',
          brief: '\u201CCinderfall, Ember system. Through the burn with the seal intact.\u201D',
          dest: 'ember:Cinderfall', deadlineMs: 8 * 60 * 1000 },
        { type: 'deliver', n: 10, reward: 700, standing: 6,
          title: 'Courier\u2019s Gamble IV: The Long Loop',
          brief: '\u201CFull loop home: Haven Dock, Solace. The ledger\u2019s watching.\u201D',
          dest: 'solace:Haven Dock', deadlineMs: 10 * 60 * 1000 }
      ] },
    { id: 'dead-mans-ledger', title: 'Dead Man\u2019s Ledger', faction: 'ember',
      bonus: 800, bonusStanding: 10,
      stages: [
        { type: 'kill', n: 4, reward: 220, standing: 4,
          title: 'Dead Man\u2019s Ledger I: Page One',
          brief: '\u201CThe ledger opens with blood: 4 pirate scalps, anywhere.\u201D' },
        { type: 'kill', n: 7, reward: 380, standing: 5,
          title: 'Dead Man\u2019s Ledger II: Page Two',
          brief: '\u201CThe Ashen Throne pays for 7 more. Make them count.\u201D' },
        { type: 'escort', n: 1, reward: 520, standing: 6,
          title: 'Dead Man\u2019s Ledger III: The Bait',
          brief: '\u201CFly the marked lane as bait. Undock \u2014 the hit squad is already waiting.\u201D' },
        { type: 'hunt', n: 1, reward: 900, standing: 8,
          title: 'Dead Man\u2019s Ledger IV: Morvane the Pale',
          brief: '\u201CLast page: Morvane the Pale flies a bulwark gunship. Undock \u2014 he\u2019ll come to you.\u201D',
          targetElite: 'bulwark', eliteName: 'Morvane the Pale' }
      ] }
  ];

  function chainById(id) {
    for (var i = 0; i < SIDE_CHAINS.length; i++)
      if (SIDE_CHAINS[i].id === id) return SIDE_CHAINS[i];
    return null;
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  var SQ = {

    chains: SIDE_CHAINS,

    stageOf: function (id) { return (qs().sqProg || {})[id] || 0; },
    chainDone: function (id) { return !!((qs().sqDone || {})[id]); },
    activeFor: function (id) {
      return (qs().active || []).filter(function (q) { return q.sqChain === id; })[0] || null;
    },
    canOffer: function (id) {
      return !this.chainDone(id) && !this.activeFor(id);
    },

    /* ---- timed deliveries: expire past-deadline runs. Called from
     * offerStage, openLog, and the turnIn wrap — no per-frame hook needed. */
    expireTick: function () {
      var st = qs(), now = Date.now(), changed = false;
      (st.active || []).forEach(function (q) {
        if (q.sqChain && q.type === 'deliver' && q.state === 'active' && now > q.deadline) {
          q.state = 'expired'; changed = true;
          if (SF.HUD && SF.HUD.toast)
            SF.HUD.toast('\u2716 Courier run expired \u2014 the client found another pilot.');
          if (window.SF && SF.News)
            SF.News.push('\uD83D\uDCE6 A courier run expired \u2014 the manifest went to a faster pilot.');
        }
      });
      if (changed) {
        st.active = st.active.filter(function (q) { return q.state !== 'expired'; });
        if (SF.Save) SF.Save.save();
      }
      return changed;
    },

    offerStage: function (id) {
      this.expireTick();
      if (!this.canOffer(id)) return false;
      var chain = chainById(id);
      if (!chain) return false;
      var stage = this.stageOf(id);
      var def = chain.stages[stage];
      if (!def) return false;
      var q = {
        id: 'sq-' + id + '-s' + stage + '-' + Date.now().toString(36),
        type: def.type, n: def.n, diff: stage, reward: def.reward,
        faction: chain.faction, weapon: null,
        station: SF.Game.systemId + ':' + SF.Game.dockedAt,
        progress: 0, state: 'active',
        sqChain: id, sqStage: stage, name: def.title, brief: def.brief
      };
      if (def.type === 'deliver') {
        q.dest = def.dest;
        q.deadline = Date.now() + def.deadlineMs;
      }
      if (def.type === 'hunt') {
        q.sqTargetElite = def.targetElite;
        q.sqEliteName = def.eliteName;
      }
      qs().active.push(q);
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Side quest: ' + def.title);
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* ---- deliver turn-in: handled here, not by the base turnIn (the
     * destination differs from the offering station). */
    turnInDeliver: function (q) {
      var st = qs();
      this.expireTick();
      if ((st.active || []).indexOf(q) < 0) return false;
      if (Date.now() > q.deadline) return false;
      var here = SF.Game.systemId + ':' + SF.Game.dockedAt;
      var ds = (q.dest || '').split(':');
      if (here !== q.dest) {
        var sysName = (SF.SYSTEM_BY_ID[ds[0]] || {}).name || ds[0];
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Deliver the manifest to ' + ds[1] + ' (' + sysName + ').');
        return false;
      }
      var chain = chainById(q.sqChain);
      var stand = chain ? chain.stages[q.sqStage].standing : 3;
      SF.Player.credits += q.reward;
      if (SF.Factions) SF.Factions.shift(q.faction, stand);
      st.active.splice(st.active.indexOf(q), 1);
      st.done = (st.done || 0) + 1;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u2714 Delivered on time: +' + q.reward + 'cr');
      if (window.SF && SF.News)
        SF.News.push('\uD83D\uDCE6 Courier run complete: sealed manifest delivered to ' +
          ds[1] + ' (' + q.reward + 'cr).');
      if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      if (SF.Save) SF.Save.save();
      this.onStageTurnedIn(q);
      return true;
    },

    /* ---- called after any successful side-chain stage turn-in. */
    onStageTurnedIn: function (q) {
      var chain = chainById(q.sqChain);
      if (!chain) return;
      /* normalize the base turn-in's own standing formula (5+diff*2) to
       * this stage's designed standing; deliver quests bypass the base. */
      if (q.type !== 'deliver' && SF.Factions) {
        var want = chain.stages[q.sqStage].standing;
        var base = 5 + q.diff * 2;
        if (want !== base) SF.Factions.shift(q.faction, want - base);
      }
      var st = qs();
      st.sqProg = st.sqProg || {};
      var next = Math.max(st.sqProg[q.sqChain] || 0, q.sqStage + 1);
      st.sqProg[q.sqChain] = next;
      if (next >= chain.stages.length) {
        st.sqDone = st.sqDone || {};
        st.sqDone[q.sqChain] = true;
        SF.Player.credits += chain.bonus;
        if (SF.Factions) SF.Factions.shift(chain.faction, chain.bonusStanding);
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('\uD83C\uDFC6 CHAIN COMPLETE: ' + chain.title + ' \u2014 bonus +' +
            chain.bonus + 'cr');
        if (window.SF && SF.News)
          SF.News.push('\uD83C\uDFC6 ' + chain.title + ' complete \u2014 the lanes will remember this one.');
        if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      } else if (SF.HUD && SF.HUD.toast) {
        SF.HUD.toast('\u27A4 Next: ' + chain.stages[next].title + ' \u2014 on any quest board');
      }
      if (SF.Save) SF.Save.save();
    },

    /* ---- quest board section (appended after the base board). */
    renderChains: function (body) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = 'SIDE CHAINS';
      body.appendChild(h);
      var self = this;
      this.chains.forEach(function (chain) {
        var row = document.createElement('div');
        row.className = 'store-row';
        var info = document.createElement('div');
        info.className = 'store-info';
        var prog = self.stageOf(chain.id);
        if (self.chainDone(chain.id)) {
          info.innerHTML = '<div><div class="store-name">\uD83C\uDFC6 ' + chain.title +
            '</div><div class="store-desc">Complete. Bonus claimed.</div></div>';
          row.appendChild(info);
          body.appendChild(row);
          return;
        }
        if (self.activeFor(chain.id)) {
          info.innerHTML = '<div><div class="store-name">\u25B6 ' + chain.title +
            '</div><div class="store-desc">Stage ' + (prog + 1) + '/' + chain.stages.length +
            ' in progress \u2014 see the quest log.</div></div>';
          row.appendChild(info);
          body.appendChild(row);
          return;
        }
        var def = chain.stages[prog];
        if (!def) return;
        var fd = SF.FACTION_BY_ID[chain.faction];
        var extra = '';
        if (def.type === 'deliver') {
          var ds = (def.dest || '').split(':');
          extra = '<br>\u23F3 Timed: ' + Math.round(def.deadlineMs / 60000) +
            ' min \u2192 ' + ds[1] + ' (' + ((SF.SYSTEM_BY_ID[ds[0]] || {}).name || ds[0]) + ')';
        } else if (def.type === 'hunt') {
          extra = '<br>\u26A0 Bounty: ' + def.eliteName + ' (elite ' + def.targetElite + ' gunship)';
        }
        info.innerHTML = '<div><div class="store-name">' + def.title +
          '</div><div class="store-desc">' + def.brief +
          '<br>Reward: <b>' + def.reward + 'cr</b> \u00B7 <span style="color:' + fd.color + '">' +
          fd.name + '</span> +' + def.standing + extra +
          '<br><i>' + chain.title + ' \u2014 stage ' + (prog + 1) + '/' +
          chain.stages.length + '</i></div></div>';
        row.appendChild(info);
        var btn = document.createElement('button');
        btn.className = 'btn store-btn';
        btn.textContent = 'ACCEPT';
        (function (cid) {
          btn.addEventListener('click', function () {
            if (self.offerStage(cid)) SF.Station.renderStore();
          });
        })(chain.id);
        row.appendChild(btn);
        body.appendChild(row);
      });
    }
  };

  SF.SideQuests = SQ;

  /* ---- turnIn wrap: deliver quests are handled by SQ; hunt quests are
   * treated as kill by the base; every successful stage turn-in advances
   * the chain. Chains under the __cq and __skills wraps. */
  (function () {
    var orig = SF.Quests && SF.Quests.turnIn;
    if (!orig || orig.__sq) return;
    var w = function (questId) {
      var st = qs();
      var q = (st.active || []).filter(function (x) { return x.id === questId; })[0] || null;
      if (q && q.sqChain) {
        if (q.type === 'deliver') return SQ.turnInDeliver(q);
        var wasHunt = (q.type === 'hunt');
        if (wasHunt) q.type = 'kill';
        var ok = orig.apply(this, arguments);
        if (wasHunt) q.type = 'hunt';
        if (ok) SQ.onStageTurnedIn(q);
        return ok;
      }
      return orig.apply(this, arguments);
    };
    w.__sq = true;
    SF.Quests.turnIn = w;
  })();

  /* ---- onKill wrap: only the spawned elite counts for 'hunt' stages. */
  (function () {
    var orig = SF.Quests && SF.Quests.onKill;
    if (!orig || orig.__sqk) return;
    var w = function (e) {
      var self = this;
      this.active().forEach(function (q) {
        if (q.type === 'hunt' && q.state === 'active' && q.sqTargetElite &&
            e && e.elite === q.sqTargetElite) {
          q.progress++;
          if (SF.HUD && SF.HUD.toast && q.progress >= q.n)
            SF.HUD.toast('Bounty claimed: ' + q.sqEliteName + ' \u2014 return to ' +
              q.station.split(':')[1]);
        }
      });
      return orig.apply(this, arguments);
    };
    w.__sqk = true;
    SF.Quests.onKill = w;
  })();

  /* ---- onUndock wrap: spawn the bounty elite on first undock after
   * accepting a hunt stage. */
  (function () {
    var orig = SF.Quests && SF.Quests.onUndock;
    if (!orig || orig.__squ) return;
    var w = function () {
      var here = SF.Game.systemId + ':' + SF.Game.dockedAt;
      var r = orig.apply(this, arguments);
      this.active().forEach(function (q) {
        if (q.type === 'hunt' && q.state === 'active' && q.sqTargetElite &&
            !q.sqSpawned && q.station === here) {
          q.sqSpawned = true;
          try {
            var mul = SF.SYSTEM_BY_ID[SF.Game.systemId] ?
              SF.SYSTEM_BY_ID[SF.Game.systemId].enemyMul : 1;
            var a = Math.random() * Math.PI * 2;
            var e = SF.Enemies.spawn('gunship',
              SF.Player.x + Math.cos(a) * 650, SF.Player.y + Math.sin(a) * 650,
              mul, { elite: q.sqTargetElite });
            if (e) { e.eliteName = q.sqEliteName; e.sqBounty = q.id; }
          } catch (err) { /* never break undock */ }
          if (SF.HUD && SF.HUD.toast)
            SF.HUD.toast('\u26A0 BOUNTY TARGET: ' + q.sqEliteName +
              ' \u2014 elite ' + q.sqTargetElite + ' gunship inbound!');
          if (SF.Audio && SF.Audio.alert) SF.Audio.alert();
          if (SF.Save) SF.Save.save();
        }
      });
      return r;
    };
    w.__squ = true;
    SF.Quests.onUndock = w;
  })();

  /* ---- openLog wrap: expire past-due deliveries and show a live
   * countdown + destination on deliver quests before the base renders. */
  (function () {
    var orig = SF.Quests && SF.Quests.openLog;
    if (!orig || orig.__sqo) return;
    var w = function () {
      SQ.expireTick();
      var here = SF.Game.systemId + ':' + SF.Game.dockedAt;
      (qs().active || []).forEach(function (q) {
        if (q.sqChain && q.type === 'deliver' && q.state === 'active') {
          if (!q.sqBrief0) q.sqBrief0 = q.brief;
          var ds = (q.dest || '').split(':');
          var sysName = (SF.SYSTEM_BY_ID[ds[0]] || {}).name || ds[0];
          q.brief = q.sqBrief0 + ' \u2014 \u23F3 ' + fmtClock(q.deadline - Date.now()) +
            ' left \u00B7 deliver to ' + ds[1] + ' (' + sysName + ')';
          q.progress = (here === q.dest) ? 1 : 0;
          q.n = 1;
        }
      });
      return orig.apply(this, arguments);
    };
    w.__sqo = true;
    SF.Quests.openLog = w;
  })();

  /* ---- renderBoard wrap: append the SIDE CHAINS section. */
  (function () {
    var orig = SF.Quests && SF.Quests.renderBoard;
    if (!orig || orig.__sqr) return;
    var w = function (body) {
      var r = orig.apply(this, arguments);
      SQ.renderChains(body);
      return r;
    };
    w.__sqr = true;
    SF.Quests.renderBoard = w;
  })();
})();
/* ============================================================
 * territory-war-contracts phase: SF.WarContracts — war contracts
 * posted at the three faction HQ mission boards (Aegis Citadel /
 * Karavan Prime / Ashen Throne), driven by the faction-warfare
 * territory control (factions.js).
 *
 *   ASSAULT: kill N ships of faction X in a system where X holds
 *            majority. Turn-in at the offering HQ shifts X's control
 *            there by exactly -6.
 *   DEFEND:  survive 3 raid waves in a system the offering faction
 *            holds. Turn-in at the offering HQ shifts the issuer's
 *            control there by exactly +6.
 *
 * Paid in credits + faction standing, both scaled by the control
 * swing: reward = round((creditBase + perKill*kills) * (1+|swing|/12)/5)*5,
 * standing = standingBase + |swing|.
 *
 * Integration is additive-only (no edits to quests.js base, factions.js,
 * station.js, planets.js, enemies.js, save.js):
 *   - contracts ride the existing quest OBJECT shape
 *     {id,type,n,reward,faction,station,progress,state,name,brief}
 *     with a `war` marker, stored in an additive blob on the existing
 *     questState blob: questState.warcb = { offers: { hqId: [...] } }.
 *     Active war contracts live in questState.active like every other
 *     quest, so the base quest log, quest board active list, and base
 *     turnIn plumbing render and pay them unchanged.
 *   - the war board section is injected into the HQ store by a lazy
 *     __war wrap on SF.FactionContracts.renderTab (factions.js untouched).
 *   - assault kill progress rides a lazy __war wrap on SF.Quests.onKill
 *     (chains with the __cq/__sq/__hqcb/__df wraps; counts only
 *     e.faction === targetFaction kills in the target system).
 *   - defend raid waves ride a lazy __war wrap on SF.Quests.onUndock
 *     (spawns wave cleared+1 in the target system) plus the onKill
 *     wrap for wave-clear detection. Defend quests stash/reset their
 *     progress around the base onKill so pirate kills can't complete
 *     the quest before the waves do.
 *   - control shifts ride a lazy __war wrap on SF.Quests.turnIn,
 *     applied after the base payout; standing is normalized to the
 *     swing-scaled formula.
 *   - announcements use SF.News.push only when present.
 * Save-neutral: the warcb blob and `war` quest markers round-trip
 * through ship.js serialize()/deserialize() (deep JSON copy of the
 * whole questState). No SF.SAVE_VERSION bump.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  /* ---- tuning ---- */
  var ASSAULT_KILLS = 5;
  var ASSAULT_SWING = -6;
  var DEFEND_WAVES = 3;
  var DEFEND_SWING = 6;
  var DEFEND_WAVE_SIZE = [3, 4, 5];
  var TUNE = {
    assaultKills: ASSAULT_KILLS, assaultSwing: ASSAULT_SWING,
    defendWaves: DEFEND_WAVES, defendSwing: DEFEND_SWING,
    defendWaveSize: DEFEND_WAVE_SIZE.slice(),
    assaultCreditBase: 400, assaultPerKill: 60,
    defendCreditBase: 500, defendPerWave: 150,
    standingBase: 2,
    assaultGate: 0,   /* issuer standing needed to take assault work */
    defendGate: 10    /* issuer standing needed to take defend work */
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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
  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }
  function qs() {
    try { return (SF.Player && SF.Player.questState) || null; } catch (e) { return null; }
  }

  /* enemies.js exposes either an array or an accessor; handle both. */
  function enemyList() {
    var l = SF.Enemies.list;
    return (typeof l === 'function') ? l() : l;
  }

  function hqById(hqId) {
    if (window.SF && SF.HQ_BY_ID && SF.HQ_BY_ID[hqId]) return SF.HQ_BY_ID[hqId];
    if (window.SF && SF.FACTION_HQ) {
      for (var i = 0; i < SF.FACTION_HQ.length; i++)
        if (SF.FACTION_HQ[i].id === hqId) return SF.FACTION_HQ[i];
    }
    return null;
  }

  function standingOf(fid) {
    try { return (window.SF && SF.Factions) ? SF.Factions.standing(fid) : 0; }
    catch (e) { return 0; }
  }

  /* Additive blob on the existing questState:
   *   questState.warcb = { offers: { hqId: [contract...] } }
   * Active war contracts live in questState.active (with `war` markers),
   * so the base log/board/turnIn render them unchanged. */
  function warBlob() {
    var st = qs();
    if (!st || typeof st !== 'object') return null;
    var b = st.warcb;
    if (!b || typeof b !== 'object') b = st.warcb = {};
    if (!b.offers || typeof b.offers !== 'object') b.offers = {};
    return b;
  }

  /* ---- reward math (scaled by the control swing) ---- */
  function assaultReward() {
    return Math.round((TUNE.assaultCreditBase + TUNE.assaultPerKill * ASSAULT_KILLS) *
      (1 + Math.abs(ASSAULT_SWING) / 12) / 5) * 5;
  }
  function defendReward() {
    return Math.round((TUNE.defendCreditBase + TUNE.defendPerWave * DEFEND_WAVES) *
      (1 + Math.abs(DEFEND_SWING) / 12) / 5) * 5;
  }
  function warStanding(swing) { return TUNE.standingBase + Math.abs(swing); }

  /* ---- assault target: the (faction X != issuer, system) pair where X
   * holds majority and has the highest control value. Deterministic:
   * SF.FACTION_LIST order, then SF.SYSTEMS order, wins ties. ---- */
  function assaultTarget(issuerFid) {
    if (!window.SF || !SF.Factions || !SF.SYSTEMS) return null;
    var best = null, bestV = -1;
    SF.FACTION_LIST.forEach(function (f) {
      if (f.id === issuerFid) return;
      SF.SYSTEMS.forEach(function (sys) {
        if (SF.Factions.majority(sys.id) !== f.id) return;
        var v = SF.Factions.control(sys.id, f.id);
        if (v > bestV) { bestV = v; best = { faction: f.id, system: sys.id }; }
      });
    });
    return best;
  }

  /* ---- defend eligibility: the HQ's own system must be held by the
   * issuing faction. ---- */
  function defendSystem(hq) {
    if (!window.SF || !SF.Factions || !hq) return null;
    return (SF.Factions.majority(hq.systemId) === hq.factionId) ? hq.systemId : null;
  }

  function makeAssault(hq, target) {
    var issuer = hq.factionId;
    var brief = 'War contract for the ' + factionName(issuer) +
      ': destroy ' + ASSAULT_KILLS + ' ' + factionName(target.faction) +
      ' patrol ships in the ' + sysName(target.system) + ' system, where the ' +
      factionName(target.faction) + ' hold majority. Each kill erodes their grip; ' +
      'turn-in shifts their control by exactly ' + ASSAULT_SWING + '. [war-contract]';
    return {
      id: 'war-assault-' + hq.id + '-' + target.faction + '-' + Date.now().toString(36),
      type: 'kill', n: ASSAULT_KILLS, diff: 1, reward: assaultReward(),
      faction: issuer, weapon: null,
      station: hq.systemId + ':' + hq.name,
      progress: 0, state: 'offer',
      name: '\u2694 WAR ASSAULT: Hit the ' + factionName(target.faction) +
        ' in ' + sysName(target.system),
      brief: brief,
      war: { kind: 'assault', issuer: issuer, targetFaction: target.faction,
             targetSystem: target.system, swing: ASSAULT_SWING,
             standing: warStanding(ASSAULT_SWING) }
    };
  }

  function makeDefend(hq, systemId) {
    var issuer = hq.factionId;
    var brief = 'War contract for the ' + factionName(issuer) +
      ': undock in the ' + sysName(systemId) + ' system and survive ' + DEFEND_WAVES +
      ' raid waves. Success shifts ' + factionName(issuer) + ' control there by exactly +' +
      DEFEND_SWING + '. [war-contract]';
    return {
      id: 'war-defend-' + hq.id + '-' + Date.now().toString(36),
      type: 'kill', n: DEFEND_WAVES, diff: 1, reward: defendReward(),
      faction: issuer, weapon: null,
      station: hq.systemId + ':' + hq.name,
      progress: 0, state: 'offer',
      name: '\u2694 WAR DEFEND: Hold ' + sysName(systemId),
      brief: brief,
      war: { kind: 'defend', issuer: issuer, targetSystem: systemId,
             swing: DEFEND_SWING, standing: warStanding(DEFEND_SWING),
             waves: DEFEND_WAVES, cleared: 0 }
    };
  }

  function activeForHQ(b, hqId) {
    var st = qs();
    return ((st && st.active) || []).filter(function (q) {
      return q && q.war && q.state === 'active' &&
        q.station === (hqById(hqId).systemId + ':' + hqById(hqId).name);
    });
  }

  var WC = {

    TUNE: TUNE,

    assaultTarget: assaultTarget,
    defendSystem: defendSystem,
    assaultReward: assaultReward,
    defendReward: defendReward,

    /* ---- the HQ war board: assault offers vs every rival majority
     * holder + a defend offer for the HQ's own system. Regenerated when
     * empty and the pilot holds no active war contract from this HQ. ---- */
    board: function (hqId) {
      installWraps();
      var b = warBlob();
      var hq = hqById(hqId);
      if (!b || !hq) return [];
      var list = b.offers[hqId];
      if ((!list || !list.length) && activeForHQ(b, hqId).length === 0) {
        list = b.offers[hqId] = [];
        var seen = {};
        SF.FACTION_LIST.forEach(function (f) {
          if (f.id === hq.factionId || seen[f.id]) return;
          /* one assault offer per rival faction that holds a majority
           * somewhere, targeting its strongest system */
          var tgt = null;
          if (window.SF && SF.SYSTEMS && SF.Factions) {
            var bestV = -1;
            SF.SYSTEMS.forEach(function (sys) {
              if (SF.Factions.majority(sys.id) === f.id) {
                var v = SF.Factions.control(sys.id, f.id);
                if (v > bestV) { bestV = v; tgt = { faction: f.id, system: sys.id }; }
              }
            });
          }
          if (tgt && !seen[tgt.faction]) {
            seen[tgt.faction] = true;
            list.push(makeAssault(hq, tgt));
          }
        });
        var ds = defendSystem(hq);
        if (ds) list.push(makeDefend(hq, ds));
        save();
      }
      return list || [];
    },

    /* all active war contracts */
    active: function () {
      installWraps();
      var st = qs();
      return ((st && st.active) || []).filter(function (q) {
        return q && q.war && q.state === 'active';
      });
    },

    /* ---- accept a war offer. Gates: issuer standing (assault 0+,
     * defend 10+), one active war contract per HQ, defend target still
     * held at accept time. ---- */
    accept: function (offerId) {
      installWraps();
      var b = warBlob();
      if (!b) return false;
      var found = null, hqId = null;
      Object.keys(b.offers).forEach(function (id) {
        (b.offers[id] || []).forEach(function (o) {
          if (o && o.id === offerId) { found = o; hqId = id; }
        });
      });
      if (!found) return false;
      var gate = (found.war.kind === 'defend') ? TUNE.defendGate : TUNE.assaultGate;
      var st = standingOf(found.faction);
      if (st < gate) {
        toast('The ' + factionName(found.faction) + ' won\u2019t hire you for war work at standing ' +
          st + ' (need ' + gate + '+).');
        return false;
      }
      if (activeForHQ(b, hqId).length > 0) {
        toast('Finish your active war contract first.');
        return false;
      }
      if (found.war.kind === 'defend') {
        var hq = hqById(hqId);
        if (defendSystem(hq) !== found.war.targetSystem) {
          toast('The ' + factionName(found.faction) + ' lost ' +
            sysName(found.war.targetSystem) + ' \u2014 the defend contract is void.');
          var bi = b.offers[hqId].indexOf(found);
          if (bi >= 0) b.offers[hqId].splice(bi, 1);
          save();
          return false;
        }
      }
      var i = b.offers[hqId].indexOf(found);
      if (i >= 0) b.offers[hqId].splice(i, 1);
      found.state = 'active';
      found.progress = 0;
      qs().active.push(found);
      toast('\u2694 War contract accepted: ' + found.name + ' (' + found.reward + 'cr on completion)');
      if (window.SF && SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      news('\u2694 ' + factionName(found.faction) + ' war board: a captain took "' +
        found.name + '" (' + found.reward + 'cr, control swing ' +
        (found.war.swing > 0 ? '+' : '') + found.war.swing + ').');
      save();
      if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      return true;
    },

    /* ---- kill hook (called by the __war wrap on SF.Quests.onKill,
     * after the base + other phases counted). ---- */
    onKill: function (e) {
      installWraps();
      if (!e) return;
      var st = qs();
      if (!st) return;
      var self = this, changed = false;
      (st.active || []).forEach(function (q) {
        if (!q || !q.war || q.state !== 'active') return;
        if (q.war.kind === 'assault') {
          /* only faction-X patrol kills IN the target system count */
          if (e.faction === q.war.targetFaction &&
              window.SF && SF.Game && SF.Game.systemId === q.war.targetSystem &&
              q.progress < q.n) {
            q.progress++;
            changed = true;
            if (q.progress >= q.n)
              toast('\u2694 Assault complete \u2014 turn in at ' + q.station.split(':')[1] +
                ' (control ' + q.war.swing + ').');
            else
              toast('\u2694 Assault: ' + q.progress + '/' + q.n + ' ' +
                factionName(q.war.targetFaction) + ' patrols down');
          }
        } else if (q.war.kind === 'defend') {
          /* wave-clear detection: tagged raiders only */
          if (e.warTag === q.id) {
            var left = enemyList().filter(function (x) { return x.warTag === q.id; });
            if (left.length === 0 && q.war.cleared < q.war.waves) {
              q.war.cleared++;
              q.progress = q.war.cleared;
              changed = true;
              if (q.war.cleared >= q.war.waves) {
                toast('\u2694 Hold complete \u2014 ' + q.war.waves + ' waves survived! Turn in at ' +
                  q.station.split(':')[1] + ' (control +' + q.war.swing + ').');
                news('\u2694 A captain held ' + sysName(q.war.targetSystem) + ' through ' +
                  q.war.waves + ' raid waves for the ' + factionName(q.war.issuer) + '.');
              } else {
                toast('\u2694 Wave ' + q.war.cleared + '/' + q.war.waves + ' cleared \u2014 next wave inbound!');
                self.spawnWave(q);
              }
            }
          }
        }
      });
      if (changed) save();
    },

    /* ---- defend wave spawner: waveSize[cleared] pirates around the
     * player, tagged with the quest id. ---- */
    spawnWave: function (q) {
      installWraps();
      if (!q || !q.war || q.war.kind !== 'defend') return false;
      if (!(window.SF && SF.Game && SF.Enemies && SF.Player)) return false;
      if (SF.Game.systemId !== q.war.targetSystem) return false;
      if (SF.Game.state !== 'PLAYING') return false;
      var live = enemyList().filter(function (x) { return x.warTag === q.id; });
      if (live.length) return false; /* a wave is already out */
      var w = clamp(q.war.cleared || 0, 0, DEFEND_WAVE_SIZE.length - 1);
      var count = DEFEND_WAVE_SIZE[w];
      var mul = (SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[SF.Game.systemId]) ?
        SF.SYSTEM_BY_ID[SF.Game.systemId].enemyMul : 1;
      for (var i = 0; i < count; i++) {
        var a = Math.random() * Math.PI * 2;
        var d = 550 + Math.random() * 250;
        // open-space-1: war waves spawn near the player, wherever that is.
        var ex = SF.Player.x + Math.cos(a) * d;
        var ey = SF.Player.y + Math.sin(a) * d;
        var type = (w === DEFEND_WAVE_SIZE.length - 1 && i === 0) ? 'gunship' : 'raider';
        var e = SF.Enemies.spawn(type, ex, ey, mul, {});
        if (e) e.warTag = q.id;
      }
      toast('\u2694 RAID WAVE ' + (w + 1) + '/' + q.war.waves + ' \u2014 hostiles inbound! (' +
        count + ' ships)');
      if (window.SF && SF.Audio && SF.Audio.alert) SF.Audio.alert();
      return true;
    },

    /* ---- undock hook (called by the __war wrap on SF.Quests.onUndock,
     * after the base + other phases ran). ---- */
    onUndockHook: function () {
      installWraps();
      if (!(window.SF && SF.Game)) return;
      var st = qs();
      if (!st) return;
      var self = this;
      (st.active || []).forEach(function (q) {
        if (q && q.war && q.war.kind === 'defend' && q.state === 'active' &&
            (q.war.cleared || 0) < q.war.waves &&
            SF.Game.systemId === q.war.targetSystem &&
            SF.Game.state === 'PLAYING') {
          self.spawnWave(q);
        }
      });
    },

    /* ---- turn-in effects (called by the __war wrap on SF.Quests.turnIn,
     * after the base payout succeeded). Returns the adjust() result. ---- */
    applyWarEffects: function (q) {
      if (!q || !q.war) return null;
      var res = null;
      try {
        if (window.SF && SF.Factions) {
          if (q.war.kind === 'assault') {
            res = SF.Factions.adjust(q.war.targetSystem, q.war.targetFaction, q.war.swing);
          } else if (q.war.kind === 'defend') {
            res = SF.Factions.adjust(q.war.targetSystem, q.war.issuer, q.war.swing);
          }
        }
      } catch (e) { /* territory unavailable */ }
      /* normalize standing to the swing-scaled formula (base paid 5+diff*2) */
      try {
        if (window.SF && SF.Factions) {
          var want = q.war.standing;
          var base = 5 + q.diff * 2;
          if (want !== base) SF.Factions.shift(q.faction, want - base);
        }
      } catch (e) {}
      var tgt = (q.war.kind === 'assault') ? factionName(q.war.targetFaction) :
        factionName(q.war.issuer);
      var sys = sysName(q.war.targetSystem);
      news('\u2694 WAR CONTRACT PAID: "' + q.name + '" \u2014 ' + tgt + ' control in ' +
        sys + ' ' + (q.war.swing > 0 ? '+' : '') + q.war.swing + '.');
      toast('\u2694 Territory shifts: ' + tgt + ' ' +
        (q.war.swing > 0 ? '+' : '') + q.war.swing + ' control in ' + sys + '.');
      save();
      return res;
    },

    /* ---- war board section, appended to the HQ contracts tab. ---- */
    renderWarTab: function (body, hq) {
      installWraps();
      if (!body || !hq) return false;
      var self = this;
      var fid = hq.factionId;
      var f = (window.SF && SF.FACTION_BY_ID) ? SF.FACTION_BY_ID[fid] : null;
      var st = standingOf(fid);

      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = '\u2694 WAR CONTRACTS \u2014 ' + (f ? f.short : fid);
      body.appendChild(h);
      var sub = document.createElement('div');
      sub.className = 'dim'; sub.style.marginBottom = '6px';
      sub.textContent = 'Territory war work, posted by ' + factionName(fid) +
        '. Turn-ins shift faction control \u00B16. One active war contract per HQ.';
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

      var offers = this.board(hq.id) || [];
      var hasActive = activeForHQ(warBlob(), hq.id).length > 0;
      if (!offers.length && !hasActive) {
        var none = document.createElement('div');
        none.className = 'dim';
        none.textContent = 'No war work posted right now \u2014 the front is quiet.';
        body.appendChild(none);
      }
      offers.forEach(function (o) {
        var gate = (o.war.kind === 'defend') ? TUNE.defendGate : TUNE.assaultGate;
        var gated = st < gate;
        var desc = o.brief +
          '<br>Reward: <b>' + o.reward + 'cr</b> \u00B7 +' + o.war.standing + ' ' +
          factionShort(fid) + ' standing \u00B7 control swing ' +
          (o.war.swing > 0 ? '+' : '') + o.war.swing;
        row(o.name, desc, 'ACCEPT',
          function () { if (self.accept(o.id)) SF.Station.renderStore(); },
          gated || hasActive,
          gated ? 'Requires ' + factionShort(fid) + ' standing ' + gate + ' (you: ' + st + ')'
                : 'Finish your active war contract first');
      });

      activeForHQ(warBlob(), hq.id).forEach(function (q) {
        var prog = (q.war.kind === 'defend')
          ? 'Waves survived: <b>' + (q.war.cleared || 0) + '/' + q.war.waves + '</b>'
          : 'Patrols destroyed: <b>' + q.progress + '/' + q.n + '</b>';
        var rdy = q.progress >= q.n;
        row('\u25B6 ' + q.name,
          q.brief + '<br>' + prog +
          ' \u00B7 Payout: <b>' + q.reward + 'cr</b> \u00B7 +' + q.war.standing + ' standing' +
          '<br>Turn in at: <b>' + hq.name + '</b>' +
          (rdy ? '' : '<br><span class="dim">Not complete yet.</span>'),
          'TURN IN',
          function () { SF.Quests.turnIn(q.id); },
          !rdy, rdy ? '' : 'Objective incomplete');
      });
      return true;
    }
  };

  SF.WarContracts = WC;

  /* ============================================================
   * Lazy wrap installation (this IIFE lives in quests.js, which loads
   * before factions.js — so SF.FactionContracts may not exist yet).
   * Idempotent via the __war flags; chains with the __cq/__sq/__hqcb/
   * __df wraps on the same functions.
   * ============================================================ */
  var _installed = false;

  function installWraps() {
    if (_installed) return;
    if (!window.SF || !SF.Quests) return;
    _installed = true;

    /* war kill progress (runs after base + other wraps).
     * All war quests ride type 'kill', so the base `!e.faction` counter
     * (and any chained wraps) would otherwise advance them: pirate kills
     * would complete ASSAULT quests, and wave-raider kills would complete
     * DEFEND quests before the waves do. Stash every war quest's progress
     * around the base chain (the -1 sentinel also suppresses the base
     * "contract complete" toast mid-chain); only WC.onKill's scoped
     * counting applies afterwards. */
    (function () {
      var orig = SF.Quests.onKill;
      if (!orig || orig.__war) return;
      var w = function (e) {
        var stashed = [];
        try {
          var st = qs();
          (st.active || []).forEach(function (q) {
            if (q && q.war && q.state === 'active') {
              stashed.push({ q: q, p: q.progress });
              q.progress = -1;
            }
          });
        } catch (err) {}
        var r = orig.apply(this, arguments);
        stashed.forEach(function (s) {
          s.q.progress = (s.q.war.kind === 'defend') ? (s.q.war.cleared || 0) : s.p;
        });
        try { if (window.SF && SF.WarContracts) SF.WarContracts.onKill(e); } catch (err) {}
        return r;
      };
      w.__war = true;
      SF.Quests.onKill = w;
    })();

    /* defend wave spawn on undock.
     * station.js calls SF.Quests.onUndock() BEFORE setState('PLAYING'),
     * so the immediate hook attempt runs while still DOCKED (spawnWave
     * requires PLAYING). A deferred attempt fires after the synchronous
     * undock completes, when the state is PLAYING. spawnWave's live-wave
     * guard makes a double attempt safe. */
    (function () {
      var orig = SF.Quests.onUndock;
      if (!orig || orig.__war) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        try {
          if (window.SF && SF.WarContracts) {
            SF.WarContracts.onUndockHook();
            setTimeout(function () {
              try { SF.WarContracts.onUndockHook(); } catch (e) {}
            }, 0);
          }
        } catch (e) {}
        return r;
      };
      w.__war = true;
      SF.Quests.onUndock = w;
    })();

    /* control swings + standing normalization after a war turn-in */
    (function () {
      var orig = SF.Quests.turnIn;
      if (!orig || orig.__war) return;
      var w = function (questId) {
        var q = null;
        try {
          var st = qs();
          q = (st.active || []).filter(function (x) { return x.id === questId; })[0] || null;
        } catch (e) {}
        var ok = orig.apply(this, arguments);
        if (ok && q && q.war) {
          try { if (window.SF && SF.WarContracts) SF.WarContracts.applyWarEffects(q); }
          catch (err) {}
        }
        return ok;
      };
      w.__war = true;
      SF.Quests.turnIn = w;
    })();

    /* war board section inside the HQ contracts tab */
    (function () {
      if (!SF.FactionContracts) return;
      var orig = SF.FactionContracts.renderTab;
      if (!orig || orig.__war) return;
      var w = function (body, hq) {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.WarContracts) SF.WarContracts.renderWarTab(body, hq); }
        catch (e) { /* never break the HQ store */ }
        return r;
      };
      w.__war = true;
      SF.FactionContracts.renderTab = w;
    })();
  }

  /* public entry points install lazily, so tests and the store UI work
   * even if the load listener hasn't fired yet */
  ['board', 'active', 'accept', 'onKill', 'onUndockHook', 'applyWarEffects',
   'renderWarTab', 'assaultTarget', 'defendSystem'].forEach(function (k) {
    var fn = WC[k];
    WC[k] = function () { installWraps(); return fn.apply(WC, arguments); };
  });

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') installWraps();
    else window.addEventListener('load', installWraps);
  }
})();
/* ============================================================
 * daily-contracts phase: SF.Daily — one daily contract per real
 * day, seeded by UTC date.
 *
 *   - Rotation: dayIndex % 3 -> kill-N-pirates / mine-N-tons /
 *     deliver-N-tons (deliver = hand N ore tons to the offering
 *     station via the DAILY CONTRACT board section).
 *   - Difficulty: tier from player progression (credits <1500 -> 0,
 *     <12000 -> 1, else 2). Faction seeded by date.
 *   - Rewards: credits x streak multiplier (+5% per consecutive
 *     completed day, cap +50%) + standing with the offering faction.
 *   - Streak tracked in localStorage 'starfall_daily_v1' ONLY.
 *
 * SAVE-NEUTRAL: no SF.SAVE_VERSION bump. The contract quest object
 * rides the existing questState blob (additive keys: dailyOffer,
 * daily/dailyDate/arch fields on the quest), which needs no
 * migration. The streak store is localStorage-only.
 *
 * Integration is additive-only (no edits to quests.js base,
 * station.js, news.js, factions.js, save.js):
 *   - kill/mining dailies reuse the base progress hooks
 *     (onKill / onOreMined count any active quest of that type) and
 *     the quest log UI; a turnIn wrap (flag __daily) pays the
 *     streak-multiplied reward and does streak bookkeeping.
 *   - the new 'daily-deliver' type is ignored by the base hooks
 *     (base turnIn leaves ready=false for unknown types, but the
 *     __daily wrap runs first and handles every q.daily quest).
 *   - a renderBoard wrap (flag __dailyb) appends the DAILY CONTRACT
 *     section. The base quest board is not refactored.
 *   - news ticker echoes via SF.News.push (runtime call only, guarded).
 *
 * Test seams: SF.Daily._setDateOverride('YYYY-MM-DD'|null) fakes the
 * UTC day; SF.Daily._today() / _genFor() / _tierOf() expose the
 * rotation math for exact assertions.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var LS_KEY = 'starfall_daily_v1';
  var _dateOverride = null;

  /* UTC day boundary — dailies rotate on UTC midnight for everyone. */
  function todayStr() {
    if (_dateOverride) return _dateOverride;
    return new Date().toISOString().slice(0, 10);
  }
  function prevDayStr(dateStr) {
    return new Date(Date.parse(dateStr + 'T00:00:00Z') - 86400000)
      .toISOString().slice(0, 10);
  }
  function dayIndex(dateStr) {
    return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
  }
  function hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* mulberry32 — deterministic per-date RNG for the offering faction */
  function srand(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* type for kill/mine must match the base hook types exactly */
  var ARCH = {
    kill:    { type: 'kill', label: '\u2620 Kill Contract',
               desc: 'Destroy {n} hostiles anywhere.',
               n: [6, 10, 16], reward: [300, 600, 1100] },
    mine:    { type: 'mining', label: '\u26CF Mining Contract',
               desc: 'Mine {n} tons of ore.',
               n: [12, 24, 40], reward: [240, 480, 900] },
    deliver: { type: 'daily-deliver', label: '\uD83D\uDCE6 Delivery Contract',
               desc: 'Deliver {n} tons of ore to the offering station.',
               n: [8, 16, 28], reward: [260, 520, 960] }
  };
  var ARCH_ORDER = ['kill', 'mine', 'deliver'];
  var FACTIONS = ['compact', 'drifters', 'ember'];
  var STREAK_MILESTONES = [3, 5, 7, 10];

  function qs() { return SF.Player.questState; }

  /* difficulty tier from player progression (credits proxy) */
  function tierOf() {
    var c = SF.Player.credits || 0;
    return c < 1500 ? 0 : c < 12000 ? 1 : 2;
  }

  /* ---- streak store: localStorage ONLY, save-neutral ---- */
  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && typeof s.streak === 'number')
        return { streak: Math.max(0, Math.floor(s.streak)), lastDone: (typeof s.lastDone === 'string') ? s.lastDone : null };
    } catch (e) { /* private mode etc. — streak just won't persist */ }
    return { streak: 0, lastDone: null };
  }
  function saveStore(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function streakMul(streak) { return 1 + 0.05 * Math.min(Math.max(streak, 0), 10); }
  function nextResetMs() {
    return Math.max(0, Date.parse(todayStr() + 'T00:00:00Z') + 86400000 - Date.now());
  }

  function genFor(dateStr) {
    var archKey = ARCH_ORDER[dayIndex(dateStr) % ARCH_ORDER.length];
    var A = ARCH[archKey];
    var tier = tierOf();
    var rnd = srand(hash32('starfall-daily:' + dateStr));
    var faction = FACTIONS[Math.floor(rnd() * FACTIONS.length)];
    var reward = Math.round(A.reward[tier] / 5) * 5;
    return {
      id: 'daily-' + dateStr,
      type: A.type,
      arch: archKey,
      n: A.n[tier], reward: reward,
      faction: faction, standing: 5 + tier * 2,
      station: null, /* pinned to the offering station on accept */
      progress: 0, state: 'offer',
      daily: true, dailyDate: dateStr,
      name: A.label + ' \u00B7 daily',
      brief: A.desc.replace('{n}', A.n[tier])
    };
  }

  var Daily = {
    LS_KEY: LS_KEY,

    /* test seams */
    _setDateOverride: function (s) { _dateOverride = s || null; },
    _today: todayStr,
    _genFor: genFor,
    _tierOf: tierOf,

    streak: function () { return loadStore().streak; },
    streakMul: streakMul,

    /* today's offer (created lazily, not in st.offers so the base
     * per-dock re-roll never touches it) */
    offer: function () {
      var st = qs(), t = todayStr();
      if (!st.dailyOffer || st.dailyOffer.dailyDate !== t || st.dailyOffer.state !== 'offer')
        st.dailyOffer = genFor(t);
      return st.dailyOffer;
    },

    /* drop accepted-but-stale dailies from another UTC day */
    expireTick: function () {
      var st = qs(), t = todayStr(), changed = false;
      (st.active || []).forEach(function (q) {
        if (q.daily && q.dailyDate !== t) { q.state = 'expired'; changed = true; }
      });
      if (changed) {
        st.active = st.active.filter(function (q) { return q.state !== 'expired'; });
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('\u231B Daily contract expired \u2014 a new one is posted.');
        if (SF.Save) SF.Save.save();
      }
      return changed;
    },

    active: function () {
      this.expireTick();
      var t = todayStr();
      return (qs().active || []).filter(function (q) {
        return q.daily && q.dailyDate === t;
      })[0] || null;
    },

    accept: function () {
      this.expireTick();
      var st = qs();
      if (this.active()) return false; /* one daily per day */
      var q = this.offer();
      q.state = 'active';
      q.station = SF.Game.systemId + ':' + SF.Game.dockedAt;
      st.active.push(q);
      delete st.dailyOffer; /* consumed */
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('Daily contract accepted: ' + q.name);
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      if (window.SF && SF.News)
        SF.News.push('\uD83D\uDCF0 Daily contract accepted: ' + q.brief + ' (' +
          q.reward + 'cr + ' + SF.FACTION_BY_ID[q.faction].name + ' standing).');
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* deliver-N-tons: hand ore to the offering station */
    deliver: function () {
      var q = this.active();
      if (!q || q.arch !== 'deliver' || q.state !== 'active') return false;
      if (SF.Game.systemId + ':' + SF.Game.dockedAt !== q.station) {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Deliver the ore at ' + q.station.split(':')[1] + '.');
        return false;
      }
      var need = q.n - q.progress;
      if (need <= 0) return true;
      if ((SF.Player.ore || 0) < need) {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Need ' + need + ' more tons of ore in cargo.');
        return false;
      }
      SF.Player.ore -= need;
      q.progress = q.n;
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\uD83D\uDCE6 Delivered ' + q.n + ' tons \u2014 daily ready to turn in.');
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* streak-multiplied payout + streak bookkeeping. Called by the
     * turnIn wrap before the base turnIn ever sees the quest. */
    turnIn: function (q) {
      var st = qs(), t = todayStr();
      if (!q || !q.daily || q.state !== 'active') return false;
      if (q.dailyDate !== t) { this.expireTick(); return false; }
      if (SF.Game.systemId + ':' + SF.Game.dockedAt !== q.station) {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Return to ' + q.station.split(':')[1] + ' to collect.');
        return false;
      }
      if (q.progress < q.n) return false;
      /* streak: +1 when yesterday was also completed, else restart at 1 */
      var ds = loadStore();
      var newStreak = (ds.lastDone === prevDayStr(t)) ? ds.streak + 1
                    : (ds.lastDone === t) ? ds.streak : 1;
      var mul = streakMul(newStreak);
      var pay = Math.round(q.reward * mul / 5) * 5;
      SF.Player.credits += pay;
      if (SF.Factions) SF.Factions.shift(q.faction, q.standing);
      var i = st.active.indexOf(q);
      if (i >= 0) st.active.splice(i, 1);
      st.done = (st.done || 0) + 1;
      ds.streak = newStreak; ds.lastDone = t; saveStore(ds);
      var fd = SF.FACTION_BY_ID[q.faction];
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('\u2714 Daily paid: +' + pay + 'cr' +
          (mul > 1 ? ' (streak \u00D7' + mul.toFixed(2) + ')' : '') +
          ', ' + fd.name + ' +' + q.standing);
      if (window.SF && SF.News)
        SF.News.push('\uD83D\uDCF0 Daily contract complete: ' + q.brief + ' \u2014 ' +
          pay + 'cr banked, ' + newStreak + '-day streak.');
      if (STREAK_MILESTONES.indexOf(newStreak) >= 0) {
        var pct = Math.round((mul - 1) * 100);
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('\uD83D\uDD25 ' + newStreak + '-day streak! +' + pct + '% daily rewards.');
        if (window.SF && SF.News)
          SF.News.push('\uD83D\uDD25 ' + newStreak + '-day daily streak \u2014 rewards now +' + pct + '%.');
      }
      if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* DAILY CONTRACT board section (appended after the base board) */
    renderSection: function (body) {
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'DAILY CONTRACT'; body.appendChild(h);
      var self = this;
      this.expireTick();
      var q = this.active();
      var st = loadStore();
      var meta = document.createElement('div');
      meta.className = 'store-desc';
      meta.style.margin = '4px 0 8px';
      var ms = nextResetMs(),
          hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000);
      meta.textContent = 'One contract per day. Streak: ' + st.streak + ' day(s) \u00B7 +' +
        Math.round((streakMul(st.streak) - 1) * 100) + '% rewards \u00B7 new contract in ' +
        hh + 'h ' + mm + 'm.';
      body.appendChild(meta);
      var row = document.createElement('div');
      row.className = 'store-row';
      var fd;
      if (q) {
        fd = SF.FACTION_BY_ID[q.faction];
        var canTurn = q.progress >= q.n;
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">\u25B6 ' + q.name + '</div>' +
          '<div class="store-desc">' + q.brief +
          '<br>Progress: <b>' + q.progress + '/' + q.n + '</b>' +
          '<br>Reward: <b>' + q.reward + 'cr</b> (+streak) \u00B7 <span style="color:' + fd.color + '">' +
          fd.name + '</span> +' + q.standing +
          '<br>Turn in at: <b>' + q.station.split(':')[1] + '</b></div></div></div>';
        var box = document.createElement('div');
        if (q.arch === 'deliver' && q.progress < q.n) {
          var db = document.createElement('button');
          db.className = 'btn store-btn'; db.textContent = 'DELIVER ORE';
          db.addEventListener('click', function () { if (self.deliver()) SF.Station.renderStore(); });
          box.appendChild(db);
        }
        var tb = document.createElement('button');
        tb.className = 'btn store-btn'; tb.textContent = 'TURN IN';
        tb.disabled = !canTurn;
        tb.addEventListener('click', function () { self.turnIn(q); });
        box.appendChild(tb);
        row.appendChild(box);
      } else {
        var o = this.offer();
        fd = SF.FACTION_BY_ID[o.faction];
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">' + o.name + '</div>' +
          '<div class="store-desc">' + o.brief +
          '<br>Reward: <b>' + o.reward + 'cr</b> (+streak) \u00B7 <span style="color:' + fd.color + '">' +
          fd.name + '</span> +' + o.standing + '</div></div></div>' +
          '<button class="btn store-btn">ACCEPT</button>';
        row.querySelector('button').addEventListener('click', function () {
          if (self.accept()) SF.Station.renderStore();
        });
      }
      body.appendChild(row);
    }
  };

  SF.Daily = Daily;

  /* ---- turnIn wrap (flag __daily): daily quests pay with the streak
   * multiplier and update the localStorage streak. Chains outside the
   * other wraps (__cq, __sq, __war...) — daily quests carry no
   * cqId/sqChain/war markers, so there is no double-handling. */
  (function () {
    var orig = SF.Quests && SF.Quests.turnIn;
    if (!orig || orig.__daily) return;
    var w = function (questId) {
      var st = qs();
      var q = (st.active || []).filter(function (x) { return x.id === questId; })[0] || null;
      if (q && q.daily) return Daily.turnIn(q);
      return orig.apply(this, arguments);
    };
    w.__daily = true;
    SF.Quests.turnIn = w;
  })();

  /* ---- renderBoard wrap (flag __dailyb): append the DAILY CONTRACT
   * section. The base quest board is not refactored. */
  (function () {
    var orig = SF.Quests && SF.Quests.renderBoard;
    if (!orig || orig.__dailyb) return;
    var w = function (body) {
      var r = orig.apply(this, arguments);
      try { Daily.renderSection(body); } catch (e) { /* never break the board */ }
      return r;
    };
    w.__dailyb = true;
    SF.Quests.renderBoard = w;
  })();
})();
/* ============================================================
 * lifepod-contracts phase: SF.RescueContracts — lifepod rescue
 * contracts on the quest board.
 *
 *   DOCKED: the board shows a RESCUE CONTRACTS section with one fresh
 *   distress offer. ACCEPT -> contract goes active and a lifepod
 *   distress beacon spawns in the CURRENT system (drawn with the
 *   secrets.js lifepod visuals: pod ellipse + blinking light + label,
 *   plus distress pulse rings).
 *   FLY THERE: near the beacon the HUD offers "TRACTOR LIFEPOD [E]";
 *   E opens the beacon dialogue; tractoring brings the survivor aboard
 *   and plays assets/audio/sfx/lifepod.ogg via guarded SF.Audio.sfx().
 *   DOCK ANYWHERE: turn in from the quest log — reward =
 *   round(200 * systemDanger * (1 + dist/5000)) credits and +4 standing
 *   with the beacon's faction.
 *   The survivor may (60%) offer to join as a 1-3 star crew member
 *   (runtime-only: SF.Crew.make + SF.Player.hireToShip; no crew.js edit).
 *   Contracts expire 15 min after accept: removed, -2 standing with the
 *   beacon's faction, no other penalty.
 *
 * Save-neutral: the contract rides the existing questState.active quest
 * blob (type 'lifepod' + lp* keys). No SAVE_VERSION bump, no migrate fn.
 * All reads are defensive (missing lp keys -> treated as beacon stage).
 *
 * Integration is additive-only (no edits outside js/quests.js):
 *   - wraps SF.Quests.turnIn (__lpc), renderBoard (__lpcr), openLog (__lpco)
 *   - wraps SF.Secrets.nearSecret / investigate / draw (quests.js loads
 *     BEFORE secrets2.js, so secrets2's wraps chain on top of ours)
 *   - lazy-wraps SF.Secrets2.investigate once it exists (quests.js runs
 *     first, so the lazy install happens on the first nearSecret call;
 *     without it the 'rescue-pod' kind would be swallowed by secrets2)
 *   - wraps SF.HUD.showInvestigatePrompt to relabel the E prompt
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function qs() { return SF.Player.questState; }
  function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  var CONTRACT_MS = 15 * 60 * 1000;  // contracts expire 15 min after accept
  var EXPIRE_STANDING_HIT = -2;      // small standing hit on expiry
  var COMPLETE_STANDING = 4;         // standing gain on successful delivery
  var RECRUIT_CHANCE = 0.60;         // survivor offers to join as crew
  var MAX_ACTIVE = 2;                // board stops offering at 2 active rescues
  var PROMPT_R = 200;                // same prompt radius as secrets2

  /* ---------------- reward math ----------------
   * reward = round(200 * danger * distanceFactor)
   *   danger         = SF.CONFIG.bounty.dangerMul[system] (solace 1.0, drift 1.4, ember 1.9)
   *   distanceFactor = 1 + spawnDist/5000  (spawnDist: beacon distance from accept point, px)
   * Example: Ember, 2400px out -> round(200 * 1.9 * 1.48) = 562cr.          */
  function dangerOf(systemId) {
    var m = (SF.CONFIG && SF.CONFIG.bounty && SF.CONFIG.bounty.dangerMul) || {};
    var v = m[systemId];
    return (typeof v === 'number' && v > 0) ? v : 1.0;
  }

  function rewardFor(systemId, dist) {
    return Math.round(200 * dangerOf(systemId) * (1 + (dist || 0) / 5000));
  }

  function factionName(fid) {
    var f = (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid]) || null;
    return f ? f.name : fid;
  }

  var SURV_FIRST = ['Kara', 'Dain', 'Mira', 'Joss', 'Renn', 'Talia', 'Pike', 'Nyra',
    'Dax', 'Ilsa', 'Quill', 'Raza', 'Vonn', 'Sable', 'Onyx', 'Wren'];
  var SURV_LAST = ['Vane', 'Kessler', 'Dray', 'Morozov', 'Reyes', 'Volkov',
    'Ashford', 'Crane', 'Hale', 'Ivers', 'Locke', 'Mercer', 'Pryce', 'Falk'];

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* copy __-flags from an inner wrap to our outer wrapper so the chain's
   * membership stays visible even when another phase wraps over us.
   * CONTRACT (freeze-hunt-1): pass the UNBOUND function — Function.prototype
   * .bind() results do NOT carry custom properties, so copying from a bound
   * capture copies nothing and the other installers re-wrap endlessly. */
  function copyFlags(orig, w) {
    if (!orig) return;
    for (var k in orig) {
      if (k.indexOf('__') === 0 && !(k in w)) {
        try { w[k] = orig[k]; } catch (e) { /* never break wrapping */ }
      }
    }
  }

  var RC = {

    /* exported for the audit's reward math check */
    rewardFor: rewardFor,
    dangerOf: dangerOf,
    CONTRACT_MS: CONTRACT_MS,

    active: function () {
      return (qs().active || []).filter(function (q) { return q.type === 'lifepod' && q.state === 'active'; });
    },

    /* ---- one fresh distress offer per board view (not persisted) ---- */
    rollOffer: function () {
      var factionId = ['compact', 'drifters', 'ember'][rint(0, 2)];
      var dist = rint(1200, 2800);
      var systemId = SF.Game.systemId;
      var stars = Math.min(3, SF.Crew.rollStars());
      var role = SF.Crew.rollRole();
      var name = SURV_FIRST[rint(0, SURV_FIRST.length - 1)] + ' ' +
                 SURV_LAST[rint(0, SURV_LAST.length - 1)];
      return {
        faction: factionId, dist: dist, system: systemId,
        reward: rewardFor(systemId, dist),
        survivor: { name: name, role: role, stars: stars,
                    recruit: Math.random() < RECRUIT_CHANCE }
      };
    },

    accept: function (offer) {
      if (this.active().length >= MAX_ACTIVE) return false;
      var p = SF.Player;
      var a = Math.random() * Math.PI * 2;
      var bx = Math.max(100, p.x + Math.cos(a) * offer.dist);
      var by = Math.max(100, p.y + Math.sin(a) * offer.dist);
      var q = {
        id: 'lp-' + Date.now().toString(36) + rint(100, 999),
        type: 'lifepod', n: 1, progress: 0, state: 'active',
        reward: offer.reward,
        faction: offer.faction,
        station: SF.Game.systemId + ':' + SF.Game.dockedAt, // offering station (log display)
        name: '🛟 Lifepod Rescue',
        brief: 'Distress beacon: ' + factionName(offer.faction) +
               ' lifepod adrift in ' + (SF.SYSTEM_BY_ID[SF.Game.systemId] || {}).name +
               '. Tractor the survivor, deliver to ANY station.',
        lpStage: 'beacon',            // 'beacon' -> 'aboard'
        lpSystem: SF.Game.systemId,
        lpX: bx, lpY: by,
        lpDist: offer.dist,
        lpReward: offer.reward,
        lpDeadline: Date.now() + CONTRACT_MS,
        lpFaction: offer.faction,
        lpSurvivor: { name: offer.survivor.name, role: offer.survivor.role,
                      stars: offer.survivor.stars, recruit: offer.survivor.recruit }
      };
      qs().active.push(q);
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('🛟 Rescue contract accepted — distress beacon plotted in ' +
          ((SF.SYSTEM_BY_ID[SF.Game.systemId] || {}).name || 'this system'));
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      if (window.SF && SF.News)
        SF.News.push('🛟 ' + factionName(offer.faction) + ' posted a lifepod rescue contract (' +
          offer.reward + 'cr).');
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* ---- expiry: 15 min wall clock; small standing hit, nothing else ---- */
    expireTick: function () {
      var st = qs(), now = Date.now(), changed = false;
      (st.active || []).forEach(function (q) {
        if (q.type === 'lifepod' && q.state === 'active' && q.lpDeadline && now > q.lpDeadline) {
          q.state = 'expired';
          changed = true;
          if (window.SF && SF.Factions) SF.Factions.shift(q.lpFaction, EXPIRE_STANDING_HIT);
          if (SF.HUD && SF.HUD.toast)
            SF.HUD.toast('✖ Rescue contract expired — ' + factionName(q.lpFaction) +
              ' ' + EXPIRE_STANDING_HIT + ' standing.');
          if (window.SF && SF.News)
            SF.News.push('📡 A lifepod distress call went silent — the beacon died unanswered.');
        }
      });
      if (changed) {
        st.active = st.active.filter(function (q) { return q.state !== 'expired'; });
        if (SF.Save) SF.Save.save();
      }
      return changed;
    },

    /* ---- beacon proximity (wraps SF.Secrets.nearSecret) ---- */
    nearSecret: function (player, systemId) {
      var best = null;
      this.active().forEach(function (q) {
        if ((q.lpStage || 'beacon') !== 'beacon') return;   // defensive read
        if (q.lpSystem !== systemId) return;
        var dx = player.x - q.lpX, dy = player.y - q.lpY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= PROMPT_R && (!best || dist < best.dist))
          best = { kind: 'rescue-pod', d: { q: q }, dist: dist };
      });
      return best;
    },

    /* ---- E on the beacon: tractor the survivor aboard ---- */
    investigate: function (target) {
      var q = target && target.d && target.d.q;
      if (!q) return;
      this.expireTick();
      if ((q.lpStage || 'beacon') !== 'beacon') return;
      if (!(window.SF && SF.Dialogue && SF.Dialogue.open)) { this._tractor(q); return; }
      var self = this;
      SF.Dialogue.open({
        title: '🛟 DISTRESS BEACON',
        text: 'A battered lifepod tumbles in the dark, strobing a distress loop: ' +
          '\u201C\u2026mayday\u2026 hull breached\u2026 one soul aboard\u2026\u201D ' +
          'Your tractor beam can reel it in.',
        choices: [
          { label: 'Tractor the pod aboard',
            run: function () { self._tractor(q); SF.Dialogue.close(); } },
          { label: 'Leave it drifting',
            run: function () { SF.Dialogue.close(); } }
        ]
      });
    },

    _tractor: function (q) {
      var st = qs();
      if ((st.active || []).indexOf(q) < 0) return false;
      if ((q.lpStage || 'beacon') !== 'beacon') return false;
      q.lpStage = 'aboard';
      q.progress = 1;
      /* lifepod.ogg on beacon pickup, guarded (falls back to synth tone) */
      if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('lifepod');
      else if (window.SF && SF.Audio && SF.Audio.lifepod) SF.Audio.lifepod();
      var sv = q.lpSurvivor || {};
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('🛟 Survivor aboard: ' + (sv.name || 'unknown') +
          ' — deliver to ANY station.');
      if (window.SF && SF.News)
        SF.News.push('🛟 Distress beacon answered — a lifepod survivor is aboard, awaiting delivery.');
      if (SF.Save) SF.Save.save();
      return true;
    },

    /* ---- turn-in at ANY docked station (intercepts SF.Quests.turnIn) ---- */
    turnIn: function (q) {
      var st = qs();
      this.expireTick();
      if ((st.active || []).indexOf(q) < 0) return false;
      if (q.lpStage !== 'aboard') {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Rescue the survivor first — follow the distress beacon.');
        return false;
      }
      if (!SF.Game || SF.Game.state !== 'DOCKED') {
        if (SF.HUD && SF.HUD.toast)
          SF.HUD.toast('Dock at any station to hand over the survivor.');
        return false;
      }
      var reward = (typeof q.lpReward === 'number') ? q.lpReward
        : rewardFor(q.lpSystem, q.lpDist || 0);
      SF.Player.credits += reward;
      if (window.SF && SF.Factions) SF.Factions.shift(q.lpFaction, COMPLETE_STANDING);
      st.active.splice(st.active.indexOf(q), 1);
      st.done = (st.done || 0) + 1;
      var where = (SF.Game.dockedAt) || 'a station';
      if (SF.HUD && SF.HUD.toast)
        SF.HUD.toast('✔ Survivor delivered: +' + reward + 'cr, ' +
          factionName(q.lpFaction) + ' +' + COMPLETE_STANDING);
      if (window.SF && SF.News)
        SF.News.push('🛟 Lifepod survivor delivered to ' + where + ' — ' +
          reward + 'cr rescue contract paid by ' + factionName(q.lpFaction) + '.');
      if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      // crew-depth: a completed contract is a mission win
      if (window.SF && SF.Crew && SF.Player)
        SF.Crew.onMissionWon(SF.Player.ships[SF.Player.activeShip]);
      if (SF.Save) SF.Save.save();
      this.offerRecruit(q);
      return true;
    },

    /* ---- survivor may offer to join as a 1-3 star crew member ---- */
    offerRecruit: function (q) {
      var sv = q.lpSurvivor;
      if (!sv || !sv.recruit) return;
      if (!(window.SF && SF.Dialogue && SF.Dialogue.open)) return;
      if (!(window.SF && SF.Crew && SF.Crew.make)) return;
      var roleName = (SF.Crew.roleName) ? SF.Crew.roleName(sv.role) : sv.role;
      SF.Dialogue.open({
        title: '🛟 ' + String(sv.name).toUpperCase() + ' — GRATEFUL',
        text: '\u201CYou pulled me out of the dark, captain. I owe you my life — ' +
          'let me earn my bunk. I flew ' + roleName + ' before the wreck.\u201D',
        choices: [
          { label: 'Welcome aboard (' + sv.stars + '★ ' + roleName + ')',
            run: function () {
              var m = null;
              try {
                m = SF.Crew.make(sv.stars, sv.role);
                if (SF.Crew.ensure) SF.Crew.ensure(m);
                m.name = sv.name; // keep the survivor's identity
              } catch (e) { m = null; }
              var ok = !!(m && SF.Player.hireToShip &&
                SF.Player.hireToShip(m, SF.Player.activeShip));
              if (ok) {
                if (SF.HUD && SF.HUD.toast)
                  SF.HUD.toast('👥 ' + sv.name + ' joined your crew!');
                if (SF.Audio && SF.Audio.hire) SF.Audio.hire();
                if (SF.Save) SF.Save.save();
              } else if (SF.HUD && SF.HUD.toast) {
                SF.HUD.toast('Crew quarters full — ' + sv.name +
                  ' takes a berth dirtside instead.');
              }
              SF.Dialogue.close();
            } },
          { label: 'Find them a berth dirtside',
            run: function () { SF.Dialogue.close(); } }
        ]
      });
    },

    /* ---- normalize lifepod quests before the base board/log render so the
     * base TURN IN buttons behave: progress 1/1 when the survivor is aboard,
     * station = current dock (turn-in works at ANY station). ---- */
    decorateForUI: function () {
      var here = (SF.Game ? SF.Game.systemId : '') + ':' + (SF.Game ? SF.Game.dockedAt : '');
      var now = Date.now();
      this.active().forEach(function (q) {
        q.progress = ((q.lpStage || 'beacon') === 'aboard') ? 1 : 0;
        q.n = 1;
        if (SF.Game && SF.Game.state === 'DOCKED') q.station = here;
        var left = (q.lpDeadline || now) - now;
        var sv = q.lpSurvivor || {};
        q.brief = '🛟 ' + ((q.lpStage || 'beacon') === 'aboard'
          ? 'Survivor ' + (sv.name || 'unknown') + ' aboard — deliver to ANY station.'
          : 'Distress beacon in ' + ((SF.SYSTEM_BY_ID[q.lpSystem] || {}).name || q.lpSystem) +
            ' at (' + Math.round(q.lpX || 0) + ', ' + Math.round(q.lpY || 0) + ').') +
          ' ⏳ ' + fmtClock(left) + ' left · +' + (q.lpReward || 0) + 'cr · ' +
          factionName(q.lpFaction) + ' +' + COMPLETE_STANDING;
      });
    },

    renderRescueSection: function (body) {
      var h = document.createElement('div');
      h.className = 'store-head';
      h.textContent = '🛟 RESCUE CONTRACTS';
      body.appendChild(h);
      if (this.active().length >= MAX_ACTIVE) {
        var full = document.createElement('div');
        full.className = 'store-desc';
        full.textContent = 'Two rescue contracts already active — deliver or wait for expiry.';
        body.appendChild(full);
        return;
      }
      var offer = this.rollOffer();
      var self = this;
      var row = document.createElement('div');
      row.className = 'store-row';
      var sysName = (SF.SYSTEM_BY_ID[offer.system] || {}).name || offer.system;
      row.innerHTML =
        '<div class="store-info"><div><div class="store-name">🛟 Lifepod Distress Call</div>' +
        '<div class="store-desc">A ' + factionName(offer.faction) + ' lifepod is adrift in ' +
        sysName + ', ~' + offer.dist + 'px out.' +
        '<br>Reward: <b>' + offer.reward + 'cr</b> · ' + factionName(offer.faction) + ' +' +
        COMPLETE_STANDING + ' standing' +
        '<br><span class="dim">⏳ 15 min to answer · survivor may join your crew · deliver to ANY station</span>' +
        '</div></div></div>' +
        '<button class="btn store-btn">ACCEPT</button>';
      row.querySelector('button').addEventListener('click', function () {
        if (self.accept(offer)) SF.Station.renderStore();
      });
      body.appendChild(row);
    },

    /* ---- beacon drawing: secrets.js lifepod visuals (pod ellipse +
     * blinking light + label) + distress pulse rings ---- */
    draw: function (ctx, systemId, time) {
      if (!ctx) return;
      var list = this.active().filter(function (q) {
        return (q.lpStage || 'beacon') === 'beacon' && q.lpSystem === systemId;
      });
      if (!list.length) return;
      list.forEach(function (q) {
        var pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
        ctx.save();
        ctx.translate(q.lpX, q.lpY);
        ctx.rotate(-0.4);
        /* distress pulse rings */
        ctx.globalAlpha = 0.35 + 0.45 * pulse;
        ctx.strokeStyle = '#ff5f6e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 30 + (1 - pulse) * 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        /* lifepod body (mirrors secrets.js) */
        ctx.fillStyle = '#3a4152';
        ctx.beginPath(); ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#9aa3b8'; ctx.lineWidth = 1.5; ctx.stroke();
        var blink = (Math.floor(time * 2) % 2 === 0);
        ctx.fillStyle = blink ? '#ff5f6e' : '#3a1015';
        ctx.beginPath(); ctx.arc(10, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ff8f9a';
        ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('🛟 LIFEPOD', q.lpX, q.lpY - 30);
      });
    }
  };

  SF.RescueContracts = RC;

  /* ---- lazy wrap of SF.Secrets2.investigate: quests.js loads BEFORE
   * secrets2.js, so this installs on the first nearSecret/draw call,
   * before any player could press E on a beacon. ---- */
  function ensureS2Wraps() {
    var S2 = window.SF && SF.Secrets2;
    if (!S2 || !S2.investigate || S2.investigate.__lpc) return;
    var orig = S2.investigate.bind(S2);
    var w = function (target, forcedRoll) {
      if (target && target.kind === 'rescue-pod') return RC.investigate(target);
      return orig(target, forcedRoll);
    };
    w.__lpc = true;
    copyFlags(S2.investigate, w); // freeze-hunt-1: flags live on the UNBOUND fn — a bound fn hides them, which let installers re-wrap forever (chain growth -> stack overflow)
    S2.investigate = w;
  }

  /* ---- HUD: relabel the E prompt for the rescue beacon.
   * Deferred into installWraps: hud.js loads AFTER quests.js. ---- */
  function installHudWrap() {
    var H = window.SF && SF.HUD;
    if (!H || !H.showInvestigatePrompt || H.showInvestigatePrompt.__lpc) return;
    var orig = H.showInvestigatePrompt.bind(H);
    var w = function (target) {
      var r = orig(target);
      if (target && target.kind === 'rescue-pod') {
        var btn = document.getElementById('btn-investigate');
        if (btn) btn.textContent = '🛟 TRACTOR LIFEPOD [E]';
      }
      return r;
    };
    w.__lpc = true;
    copyFlags(H.showInvestigatePrompt, w); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
    H.showInvestigatePrompt = w;
  }

  /* ---- SF.Secrets wraps (secrets2's wraps chain on top when it loads
   * later; when we run first they chain under it — both orders work).
   * NOTE: quests.js loads BEFORE secrets.js/secrets2.js/hud.js in
   * index.html, so SF.Secrets / SF.HUD may not exist yet at IIFE time.
   * installWraps() is idempotent and runs now, on a deferred tick (after
   * all scripts load), and from the per-frame draw path. ---- */
  function installSecretWraps() {
    var S = window.SF && SF.Secrets;
    if (!S) return;
    if (S.nearSecret && !S.nearSecret.__lpc) {
      var origNear = S.nearSecret.bind(S);
      var wN = function (player, systemId) {
        ensureS2Wraps();
        var a = origNear(player, systemId);
        var b = RC.nearSecret(player, systemId);
        if (a && b) return (a.dist <= b.dist) ? a : b;
        return a || b;
      };
      wN.__lpc = true;
      copyFlags(S.nearSecret, wN); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
      S.nearSecret = wN;
    }
    if (S.investigate && !S.investigate.__lpc) {
      var origInv = S.investigate.bind(S);
      var wI = function (target, forcedRoll) {
        if (target && target.kind === 'rescue-pod') return RC.investigate(target);
        return origInv(target, forcedRoll);
      };
      wI.__lpc = true;
      copyFlags(S.investigate, wI); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
      S.investigate = wI;
    }
    if (S.draw && !S.draw.__lpc) {
      var origDraw = S.draw.bind(S);
      var wD = function (ctx, systemId, time) {
        ensureS2Wraps();
        installSecretWraps();
        installHudWrap();
        origDraw(ctx, systemId, time);
        RC.draw(ctx, systemId, time);
      };
      wD.__lpc = true;
      copyFlags(S.draw, wD); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
      S.draw = wD;
    }
  }
  installSecretWraps();
  installHudWrap();
  if (typeof setTimeout === 'function') setTimeout(function () {
    installSecretWraps(); installHudWrap();
  }, 50);

  /* ---- turnIn wrap: lifepod contracts turn in at ANY docked station.
   * Chains under the companion-quests (__cq), side-chain (__sq) and any
   * later wraps (same orig-chain pattern). ---- */
  (function () {
    var orig = SF.Quests && SF.Quests.turnIn;
    if (!orig || orig.__lpc) return;
    var w = function (questId) {
      var st = qs();
      var q = (st.active || []).filter(function (x) { return x.id === questId; })[0] || null;
      if (q && q.type === 'lifepod') return RC.turnIn(q);
      return orig.apply(this, arguments);
    };
    w.__lpc = true;
    copyFlags(orig, w);
    SF.Quests.turnIn = w;
  })();

  /* ---- renderBoard wrap: append the RESCUE CONTRACTS section ---- */
  (function () {
    var orig = SF.Quests && SF.Quests.renderBoard;
    if (!orig || orig.__lpcr) return;
    var w = function (body) {
      RC.expireTick();
      RC.decorateForUI();
      var r = orig.apply(this, arguments);
      RC.renderRescueSection(body);
      return r;
    };
    w.__lpcr = true;
    copyFlags(orig, w);
    SF.Quests.renderBoard = w;
  })();

  /* ---- openLog wrap: expire stale contracts + decorate before render ---- */
  (function () {
    var orig = SF.Quests && SF.Quests.openLog;
    if (!orig || orig.__lpco) return;
    var w = function () {
      RC.expireTick();
      RC.decorateForUI();
      return orig.apply(this, arguments);
    };
    w.__lpco = true;
    copyFlags(orig, w);
    SF.Quests.openLog = w;
  })();
})();

/* ============================================================
 * STARFALL — voice-wiring-v6b phase (2026-10-21)
 *
 * Wires voice-pack-6's daily-contract broker lines into SF.Daily.
 * js/quests.js ONLY — additive; nothing else in this file touched.
 *
 * Voice ids are taken verbatim from
 * phases/voice-pack-6/VOICE-MANIFEST-6.md — no invented ids:
 *   dailyaccept_01/02  — spoken once on a successful accept
 *   dailyturnin_01/02  — spoken once on a successful turn-in
 *   dailystreak_01/02/03/04 — spoken on streak milestones 3 / 5 / 7 / 10
 *   (dailystreak_04 for milestone 5 shipped by dailystreak-milestone-5-voice)
 *
 * Playback: if (SF.Audio && SF.Audio.voice) SF.Audio.voice(id)
 * (guarded, never throws) + subtitle caption reusing the shared
 * #sf-voice-caption element (interrupt pattern, same as the
 * ngplus-voice-wiring / v6 blocks).
 *
 * Save-neutral: no persisted state, no SF.SAVE_VERSION bump.
 *
 * Public surface: SF.DailyVoice6 { say, pick, ids } — test hooks.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};
  if (SF.__dailyV6bWiring) return; // no double install
  SF.__dailyV6bWiring = true;

  /* line table — ids + caption text per VOICE-MANIFEST-6.md */
  var LINES = {
    'dailyaccept_01': { n: 'BROKER', c: '#ffd23f', t: "Daily contract signed. Don't keep the broker waiting.", d: 3.47 },
    'dailyaccept_02': { n: 'BROKER', c: '#ffd23f', t: "Accepted. Finish it before the cycle turns.", d: 3.21 },
    'dailyturnin_01': { n: 'BROKER', c: '#ffd23f', t: "Contract fulfilled. Credits and standing, as promised.", d: 3.60 },
    'dailyturnin_02': { n: 'BROKER', c: '#ffd23f', t: "Clean work, contractor. Paid in full.", d: 2.99 },
    'dailystreak_01': { n: 'BROKER', c: '#ffd23f', t: "Three days running. The broker is starting to respect you.", d: 3.53 },
    'dailystreak_02': { n: 'BROKER', c: '#ffd23f', t: "Seven day streak! You're a legend on the board.", d: 2.76 },
    'dailystreak_03': { n: 'BROKER', c: '#ffd23f', t: "Ten days straight. Nobody hustles like you, captain.", d: 3.88 },
    'dailystreak_04': { n: 'BROKER', c: '#ffd23f', t: "Five days straight, captain. The broker is impressed. Keep the streak alive!", d: 4.98 }
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

  /* streak milestone -> voice id (3, 5, 7, 10 all have lines) */
  var STREAK_IDS = { 3: 'dailystreak_01', 5: 'dailystreak_04', 7: 'dailystreak_02', 10: 'dailystreak_03' };

  /* ---------------- wraps ---------------- */

  function wrap(obj, name, flag, fn) {
    if (!obj || typeof obj[name] !== 'function' || obj[name][flag]) return false;
    var orig = obj[name];
    var w = function () {
      var r = orig.apply(this, arguments);
      try { fn.call(this, r); } catch (e) { /* voice must never break the game */ }
      return r;
    };
    w[flag] = true;
    obj[name] = w;
    return true;
  }

  var Daily = SF.Daily;

  /* accept: voice only on a successful accept (returns true) */
  wrap(Daily, 'accept', '__dv6b', function (ok) {
    if (ok === true) pick('dailyaccept', 2);
  });

  /* turnIn: voice only on a successful turn-in; streak milestone fires
   * after the turn-in line (caption interrupts by design, matching the
   * other wiring blocks). */
  wrap(Daily, 'turnIn', '__dv6bt', function (ok) {
    if (ok !== true) return;
    pick('dailyturnin', 2);
    var s = 0;
    try { s = SF.Daily ? SF.Daily.streak() : 0; } catch (e) {}
    var id = STREAK_IDS[s];
    if (id) playLine(id);
  });

  SF.DailyVoice6 = {
    say: playLine,
    pick: pick,
    ids: function () { return Object.keys(LINES); }
  };
})();
/* ============================================================
 * quest-randomized-contracts phase: SF.OddJobs — procedural odd-jobs board.
 *
 * A procedural 'odd jobs' board at stations: 5 contracts per system,
 * generated from seeded templates with modifiers. Unaccepted contracts
 * expire silently on system jump (offers regenerate for the new system).
 *
 *   FETCH — deliver N tons of <good> to the offering station.
 *   HUNT  — kill N ships of a faction in the seeded system.
 *   SCOUT — visit a nav point (a planet in the seeded system).
 *
 * Modifiers (0-2 seeded per contract; RUSH only ever rides with PRESSURE):
 *   UNDER PRESSURE — timed (seeded 8-14 min window; halved with RUSH).
 *                    x1.25 reward.
 *   HAZARD PAY     — +50% reward; a raider pack ambushes on accept. x1.50.
 *   SILENT RUNNING — any kill while active voids the contract
 *                    (sponsor -2 standing). x1.50.
 *   RUSH           — half the time, double the reward. x2.00.
 *
 * Reward math (exact, exposed as OJ._rewardFor for the audit):
 *   base(fetch) = goodBase * n * 1.5 * dangerMul(system)
 *   base(hunt)  = n * 60 * dangerMul(system)
 *   base(scout) = 260 * dangerMul(system)
 *   reward = round(base * product(modifier mults) / 5) * 5
 * Turn-in standing: 3 + (number of modifiers) with the sponsor faction.
 *
 * Additive-only (no edits to the quests.js base or any other module):
 *   - contracts ride the existing quest OBJECT shape; the
 *     questState.oddjobs blob holds per-system offers; accepted contracts
 *     live in questState.active like every other quest, so the base quest
 *     log, quest board active list, abandon() and base hooks render them
 *     unchanged.
 *   - wraps SF.Quests.turnIn (__oj), renderBoard (__ojb), openLog (__ojo),
 *     onKill (__ojk); SF.Game.travelTo (__ojt, deferred — main.js loads
 *     after quests.js); SF.Secrets.nearSecret (__ojn, deferred —
 *     secrets.js loads after quests.js) for scout proximity.
 *   - fetch progress = goods in cargo; hunt progress = faction kills in
 *     the target system; scout progress = proximity to the nav point.
 * Save-neutral: everything rides questState (deep JSON copy in ship.js
 * serialize/deserialize). No SF.SAVE_VERSION bump, no migrate function.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function qs() {
    try { return (SF.Player && SF.Player.questState) || null; }
    catch (e) { return null; }
  }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function news(text) { if (window.SF && SF.News) SF.News.push(text); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function factionName(fid) {
    var f = (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid]) || null;
    return f ? f.name : fid;
  }
  function sysName(id) {
    return (window.SF && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[id]) ? SF.SYSTEM_BY_ID[id].name : id;
  }
  function goodName(id) {
    var gs = (window.SF && SF.CONFIG && SF.CONFIG.trading && SF.CONFIG.trading.goods) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i].name;
    return id;
  }
  function goodBase(id) {
    var gs = (window.SF && SF.CONFIG && SF.CONFIG.trading && SF.CONFIG.trading.goods) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i].base;
    return 20;
  }
  function dangerMul(systemId) {
    var m = (window.SF && SF.CONFIG && SF.CONFIG.bounty && SF.CONFIG.bounty.dangerMul) || {};
    var v = m[systemId];
    return (typeof v === 'number' && v > 0) ? v : 1.0;
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* mulberry32 — deterministic per-(system,roll) RNG */
  function srand(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* copy __-flags from an inner wrap to our outer wrapper so the chain's
   * membership stays visible even when another phase wraps over us.
   * CONTRACT (freeze-hunt-1): pass the UNBOUND function — Function.prototype
   * .bind() results do NOT carry custom properties, so copying from a bound
   * capture copies nothing and the other installers re-wrap endlessly. */
  function copyFlags(orig, w) {
    if (!orig) return;
    for (var k in orig) {
      if (k.indexOf('__') === 0 && !(k in w)) {
        try { w[k] = orig[k]; } catch (e) { /* never break wrapping */ }
      }
    }
  }

  /* ============================ tuning ============================ */
  var OJ_COUNT = 5;
  var SCOUT_RADIUS = 400;
  var EXPIRE_STANDING_HIT = -2;

  var MODS = {
    pressure: { id: 'pressure', name: 'UNDER PRESSURE', mult: 1.25, badge: '⏱',
                desc: 'Timed — complete before the clock runs out.' },
    hazard:   { id: 'hazard',   name: 'HAZARD PAY',     mult: 1.50, badge: '☠',
                desc: '+50% reward. Word travels fast — expect company.' },
    silent:   { id: 'silent',   name: 'SILENT RUNNING', mult: 1.50, badge: '🔇',
                desc: 'No kills allowed. One kill voids the contract.' },
    rush:     { id: 'rush',     name: 'RUSH',           mult: 2.00, badge: '⚡',
                desc: 'Half the time, double the pay.' }
  };
  var MOD_POOL = ['pressure', 'hazard', 'silent']; /* rush only rides with pressure */

  /* ============================ reward math ============================ */
  function baseReward(kind, n, systemId, goodId) {
    var d = dangerMul(systemId);
    if (kind === 'fetch') return goodBase(goodId) * n * 1.5 * d;
    if (kind === 'hunt') return n * 60 * d;
    return 260 * d; /* scout */
  }
  function rewardFor(kind, n, systemId, goodId, modIds) {
    var mult = 1;
    (modIds || []).forEach(function (id) { if (MODS[id]) mult *= MODS[id].mult; });
    return Math.round(baseReward(kind, n, systemId, goodId) * mult / 5) * 5;
  }

  /* ============================ blob ============================ */
  /* questState.oddjobs = { genFor: <systemId>, rolls: {sys: n}, offers: [...] }
   * genFor tracks which system the current offers were rolled for; a jump
   * clears it (unaccepted offers expire silently) and the next board view
   * rolls a fresh seeded batch. */
  function ojBlob() {
    var st = qs();
    if (!st || typeof st !== 'object') return null;
    var b = st.oddjobs;
    if (!b || typeof b !== 'object') b = st.oddjobs = {};
    if (!b.offers || !Array.isArray(b.offers)) b.offers = [];
    if (!b.rolls || typeof b.rolls !== 'object') b.rolls = {};
    if (typeof b.genFor !== 'string') b.genFor = '';
    return b;
  }

  /* ============================ generation ============================ */
  function makeOffer(rnd, homeSys, i) {
    var factions = ['compact', 'drifters', 'ember'];
    var systems = (window.SF && SF.SYSTEMS || []).map(function (s) { return s.id; });
    if (!systems.length) systems = ['solace', 'drift', 'ember'];
    var goods = (window.SF && SF.CONFIG && SF.CONFIG.trading && SF.CONFIG.trading.goods) || [];

    var kinds = ['fetch', 'hunt', 'scout'];
    var kind = kinds[Math.floor(rnd() * kinds.length)];
    var sponsor = factions[Math.floor(rnd() * factions.length)];
    var targetSys = systems[Math.floor(rnd() * systems.length)];

    /* 0-2 distinct seeded modifiers; rush only rides with pressure */
    var mods = [];
    var pool = MOD_POOL.slice();
    var mcount = Math.floor(rnd() * 3);
    for (var m = 0; m < mcount; m++) {
      var mi = Math.floor(rnd() * pool.length);
      mods.push(pool.splice(mi, 1)[0]);
    }
    if (mods.indexOf('pressure') >= 0 && mods.length < 2 && rnd() < 0.35) mods.push('rush');

    var q = {
      id: 'oj-' + homeSys + '-' + Date.now().toString(36) + '-' + i +
           Math.floor(rnd() * 1296).toString(36),
      type: 'oj_' + kind, kind: kind, oddjob: true,
      diff: 0, reward: 0, baseReward: 0, mult: 1, weapon: null,
      faction: sponsor,
      station: homeSys + ':' + (window.SF && SF.Game ? SF.Game.dockedAt : 'Haven Dock'),
      progress: 0, state: 'offer',
      mods: mods, target: { system: targetSys }
    };
    if (kind === 'fetch') {
      var g = goods.length ? goods[Math.floor(rnd() * goods.length)] : { id: 'food' };
      q.n = 4 + Math.floor(rnd() * 9); /* 4..12 tons */
      q.target.goodId = g.id;
    } else if (kind === 'hunt') {
      q.n = 4 + Math.floor(rnd() * 7); /* 4..10 kills */
      q.target.faction = factions[Math.floor(rnd() * factions.length)];
    } else {
      q.n = 1;
      var pts = (window.SF && SF.PLANETS || []).filter(function (p) {
        return p.systemId === targetSys;
      });
      if (pts.length) {
        var pt = pts[Math.floor(rnd() * pts.length)];
        q.target.px = pt.x; q.target.py = pt.y; q.target.place = pt.name;
      } else {
        q.target.px = 2100; q.target.py = 2100; q.target.place = 'system center';
      }
    }
    q.baseReward = baseReward(kind, q.n, targetSys, q.target.goodId);
    q.mult = mods.reduce(function (a, id) { return a * MODS[id].mult; }, 1);
    q.reward = Math.round(q.baseReward * q.mult / 5) * 5;
    if (mods.indexOf('pressure') >= 0) {
      q.deadlineMs = (8 + Math.floor(rnd() * 7)) * 60000; /* 8..14 min full window */
    }
    q.name = ojName(q);
    q.brief = ojBrief(q);
    return q;
  }

  function ojName(q) {
    if (q.kind === 'fetch')
      return '📦 Odd Job: Haul ' + goodName(q.target.goodId);
    if (q.kind === 'hunt')
      return '🎯 Odd Job: Hunt ' + factionName(q.target.faction);
    return '📍 Odd Job: Chart ' + (q.target.place || 'a nav point');
  }

  function modBadges(q) {
    if (!q.mods || !q.mods.length) return '';
    return ' ' + q.mods.map(function (id) {
      return '[' + MODS[id].badge + ' ' + MODS[id].name + ']';
    }).join(' ');
  }

  function ojBrief(q) {
    var t = q.target;
    var s = '';
    if (q.kind === 'fetch') {
      s = 'Deliver ' + q.n + 't of ' + goodName(t.goodId) + ' to ' +
        q.station.split(':')[1] + '. Sponsor: ' + factionName(q.faction) + '.';
    } else if (q.kind === 'hunt') {
      s = 'Destroy ' + q.n + ' ' + factionName(t.faction) + ' ships in the ' +
        sysName(t.system) + ' system. Sponsor: ' + factionName(q.faction) + '.';
    } else {
      s = 'Chart the nav point "' + (t.place || 'unknown') + '" in the ' +
        sysName(t.system) + ' system — fly within sensor range. Sponsor: ' +
        factionName(q.faction) + '.';
    }
    return s + modBadges(q);
  }

  function genOffers() {
    var b = ojBlob();
    if (!b || !window.SF || !SF.Game) return [];
    var sys = SF.Game.systemId;
    var roll = (b.rolls[sys] || 0) + 1;
    b.rolls[sys] = roll;
    b.genFor = sys;
    var rnd = srand(hash32('oddjobs:' + sys + ':' + roll));
    var offers = [];
    for (var i = 0; i < OJ_COUNT; i++) offers.push(makeOffer(rnd, sys, i));
    b.offers = offers;
    save();
    return offers;
  }

  /* ============================ hazard ambush ============================ */
  function spawnAmbush() {
    try {
      if (!window.SF || !SF.Enemies || !SF.Player || !SF.Game) return;
      var mul = (SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID[SF.Game.systemId]) ?
        SF.SYSTEM_BY_ID[SF.Game.systemId].enemyMul : 1;
      for (var i = 0; i < 3; i++) {
        var a = Math.random() * Math.PI * 2;
        var d = 600 + Math.random() * 300;
        SF.Enemies.spawn('raider',
          SF.Player.x + Math.cos(a) * d, SF.Player.y + Math.sin(a) * d,
          mul, {});
      }
      toast('☠ HAZARD PAY — word travels fast: raiders inbound!');
      if (SF.Audio && SF.Audio.alert) SF.Audio.alert();
    } catch (e) { /* never break accept */ }
  }

  /* ============================ SF.OddJobs ============================ */
  var OJ = {

    /* exact-reward test seams */
    _rewardFor: rewardFor,
    _baseReward: baseReward,
    _MODS: MODS,
    _OJ_COUNT: OJ_COUNT,

    /* current offers for this system; rolls a fresh seeded batch when
     * the system was jumped since the last batch (unaccepted offers from
     * the old system are gone — silent expiry). */
    offers: function () {
      installWraps();
      var b = ojBlob();
      if (!b || !window.SF || !SF.Game) return [];
      if (b.genFor !== SF.Game.systemId) genOffers();
      return b.offers;
    },

    active: function () {
      return (qs() && qs().active || []).filter(function (q) {
        return q && q.oddjob && q.state === 'active';
      });
    },

    accept: function (offerId) {
      installWraps();
      this.expireTick();
      var b = ojBlob();
      if (!b) return false;
      var i = -1;
      for (var k = 0; k < b.offers.length; k++) {
        if (b.offers[k] && b.offers[k].id === offerId) { i = k; break; }
      }
      if (i < 0) return false;
      var q = b.offers.splice(i, 1)[0];
      q.state = 'active';
      q.station = SF.Game.systemId + ':' + SF.Game.dockedAt;
      q.progress = 0;
      if (q.mods.indexOf('pressure') >= 0) {
        var win = q.deadlineMs || 8 * 60000;
        if (q.mods.indexOf('rush') >= 0) win = win / 2; /* RUSH: half the time */
        q.deadline = Date.now() + win;
      }
      qs().active.push(q);
      if (q.mods.indexOf('hazard') >= 0) spawnAmbush();
      toast('📋 Odd job accepted: ' + q.name + ' (' + q.reward + 'cr)');
      if (SF.Audio && SF.Audio.questAccept) SF.Audio.questAccept();
      news('📋 Odd job posted: ' + q.name + ' — ' + q.reward + 'cr from the ' +
        factionName(q.faction) + '.');
      save();
      if (window.SF && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      return true;
    },

    /* ---- timed contracts expire (accepted ones toast; unaccepted ones
     * expire silently on jump via onJump). ---- */
    expireTick: function () {
      installWraps();
      var st = qs();
      if (!st) return false;
      var now = Date.now(), changed = false;
      (st.active || []).forEach(function (q) {
        if (q && q.oddjob && q.state === 'active' && q.deadline && now > q.deadline) {
          q.state = 'expired'; changed = true;
          toast('⏱ "' + q.name + '" lapsed — the client found another pilot.');
          news('📋 An odd-job contract lapsed unfulfilled.');
        }
      });
      if (changed) {
        st.active = st.active.filter(function (q) { return q.state !== 'expired'; });
        save();
      }
      return changed;
    },

    /* ---- system jump: unaccepted offers expire silently; the next board
     * view rolls a fresh seeded batch for the new system. ---- */
    onJump: function (systemId) {
      var b = ojBlob();
      if (!b) return;
      b.offers = [];
      b.genFor = '';
      save();
    },

    /* ---- kill hook: hunt progress + silent-running enforcement. ---- */
    onKill: function (e) {
      installWraps();
      var st = qs();
      if (!st) return;
      var changed = false, failed = [];
      (st.active || []).forEach(function (q) {
        if (!q || !q.oddjob || q.state !== 'active') return;
        if (q.mods && q.mods.indexOf('silent') >= 0) {
          failed.push(q); /* any kill voids a silent contract */
          return;
        }
        if (q.kind === 'hunt' && e && e.faction === q.target.faction &&
            window.SF && SF.Game && SF.Game.systemId === q.target.system &&
            q.progress < q.n) {
          q.progress++;
          changed = true;
          if (q.progress >= q.n)
            toast('🎯 Hunt contract complete — turn in at ' + q.station.split(':')[1] + '.');
          else
            toast('🎯 Hunt: ' + q.progress + '/' + q.n + ' ' +
              factionName(q.target.faction) + ' ships down');
        }
      });
      failed.forEach(function (q) {
        var i = st.active.indexOf(q);
        if (i >= 0) st.active.splice(i, 1);
        try {
          if (window.SF && SF.Factions) SF.Factions.shift(q.faction, EXPIRE_STANDING_HIT);
        } catch (err) {}
        toast('🔇 SILENT RUNNING violated — "' + q.name + '" void (' +
          factionName(q.faction) + ' ' + EXPIRE_STANDING_HIT + ').');
        changed = true;
      });
      if (changed) save();
    },

    /* ---- scout proximity tick (called from the per-frame nearSecret
     * wrap — main.js calls SF.Secrets.nearSecret every frame while
     * PLAYING). ---- */
    scoutTick: function (player, systemId) {
      try {
        var st = qs();
        if (!st || !window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
        var changed = false;
        (st.active || []).forEach(function (q) {
          if (!q || !q.oddjob || q.kind !== 'scout' || q.state !== 'active') return;
          if (q.progress >= q.n) return;
          if (systemId !== q.target.system) return;
          if (typeof q.target.px !== 'number') return; /* defensive */
          var dx = player.x - q.target.px, dy = player.y - q.target.py;
          if (dx * dx + dy * dy < SCOUT_RADIUS * SCOUT_RADIUS) {
            q.progress = q.n;
            toast('📍 Nav point charted: ' + (q.target.place || 'unknown') +
              ' — turn in at ' + q.station.split(':')[1] + '.');
            changed = true;
          }
        });
        if (changed) save();
      } catch (e) { /* never break the frame */ }
    },

    /* ---- turn-in: station check BEFORE touching cargo; then per-kind
     * readiness; then pay. ---- */
    turnIn: function (questId) {
      installWraps();
      var st = qs();
      if (!st) return false;
      this.expireTick();
      var q = (st.active || []).filter(function (x) { return x && x.id === questId; })[0] || null;
      if (!q || !q.oddjob || q.state !== 'active') return false;
      if (SF.Game.systemId + ':' + SF.Game.dockedAt !== q.station) {
        toast('Return to ' + q.station.split(':')[1] + ' to collect.');
        return false;
      }
      var ready = false;
      var p = SF.Player;
      if (q.kind === 'fetch') {
        var have = (p.goods && p.goods[q.target.goodId]) || 0;
        ready = have >= q.n;
        if (ready) {
          p.goods[q.target.goodId] -= q.n;
          if (p.goods[q.target.goodId] <= 0) delete p.goods[q.target.goodId];
        }
      } else if (q.kind === 'hunt' || q.kind === 'scout') {
        ready = q.progress >= q.n;
      }
      if (!ready) return false;
      p.credits += q.reward;
      var stand = 3 + (q.mods ? q.mods.length : 0);
      try {
        if (window.SF && SF.Factions) SF.Factions.shift(q.faction, stand);
      } catch (e) {}
      var i = st.active.indexOf(q);
      if (i >= 0) st.active.splice(i, 1);
      st.done = (st.done || 0) + 1;
      toast('✔ Odd job paid: +' + q.reward + 'cr, ' + factionName(q.faction) +
        ' +' + stand);
      news('📋 Odd job complete: ' + q.name + ' paid out ' + q.reward + 'cr.');
      if (SF.Audio && SF.Audio.questTurnIn) SF.Audio.questTurnIn();
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      save();
      return true;
    },

    /* ---- ODD JOBS board section (appended after the base board). ---- */
    renderSection: function (body) {
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'ODD JOBS'; body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'store-desc';
      note.style.margin = '4px 0 8px';
      note.textContent = 'Seeded contracts, refreshed on every system jump. ' +
        'Unaccepted jobs expire when you jump.';
      body.appendChild(note);
      var self = this;
      var offers = this.offers();
      if (!offers.length) {
        var d = document.createElement('div');
        d.className = 'dlg-text';
        d.textContent = 'The board is clear — jump to a new system for fresh jobs.';
        body.appendChild(d);
        return;
      }
      offers.forEach(function (o) {
        var row = document.createElement('div');
        row.className = 'store-row';
        var fd = (window.SF && SF.FACTION_BY_ID && SF.FACTION_BY_ID[o.faction]) || null;
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">' + o.name + '</div>' +
          '<div class="store-desc">' + o.brief +
          '<br>Reward: <b>' + o.reward + 'cr</b>' +
          (fd ? ' · Sponsor: <span style="color:' + fd.color + '">' + fd.name + '</span>' : '') +
          (o.deadlineMs ? '<br>⏱ Timed: ' +
            Math.round((o.mods.indexOf('rush') >= 0 ? o.deadlineMs / 2 : o.deadlineMs) / 60000) +
            ' min' : '') +
          '</div></div></div>' +
          '<button class="btn store-btn">ACCEPT</button>';
        row.querySelector('button').addEventListener('click', function () {
          self.accept(o.id);
        });
        body.appendChild(row);
      });
    }
  };

  SF.OddJobs = OJ;

  /* refresh fetch progress (goods in cargo) + live countdowns before the
   * base UI renders active quests. */
  function decorateForUI() {
    var st = qs();
    if (!st) return;
    (st.active || []).forEach(function (q) {
      if (!q || !q.oddjob) return;
      if (!q.brief0) q.brief0 = q.brief;
      if (q.kind === 'fetch') {
        var have = (window.SF && SF.Player && SF.Player.goods &&
          SF.Player.goods[q.target.goodId]) || 0;
        q.progress = Math.min(q.n, have);
      }
      var extra = '';
      if (q.deadline && q.state === 'active')
        extra = ' — ⏱ ' + fmtClock(q.deadline - Date.now()) + ' left';
      q.brief = q.brief0 + extra;
    });
  }

  /* ============================================================
   * Wrap installation. SF.Quests exists at IIFE time (same file,
   * earlier). SF.Game (main.js) and SF.Secrets (secrets.js) load
   * AFTER quests.js, so their wraps install lazily: now, on a
   * deferred tick, and from every OJ public method.
   * ============================================================ */
  var _installed = false;

  function installWraps() {
    if (!window.SF || !SF.Quests) return;

    /* turnIn: odd jobs pay through OJ.turnIn (chains under/over the
     * __cq/__sq/__war/__daily wraps — odd-job quests carry none of
     * their markers). */
    (function () {
      var orig = SF.Quests.turnIn;
      if (!orig || orig.__oj) return;
      var w = function (questId) {
        var st = qs();
        var q = st && (st.active || []).filter(function (x) {
          return x && x.id === questId;
        })[0] || null;
        if (q && q.oddjob) return OJ.turnIn(questId);
        return orig.apply(this, arguments);
      };
      w.__oj = true;
      copyFlags(orig, w);
      SF.Quests.turnIn = w;
    })();

    /* renderBoard: append the ODD JOBS section. */
    (function () {
      var orig = SF.Quests.renderBoard;
      if (!orig || orig.__ojb) return;
      var w = function (body) {
        OJ.expireTick();
        decorateForUI();
        var r = orig.apply(this, arguments);
        try { OJ.renderSection(body); } catch (e) { /* never break the board */ }
        return r;
      };
      w.__ojb = true;
      copyFlags(orig, w);
      SF.Quests.renderBoard = w;
    })();

    /* openLog: expire timed + refresh fetch progress before render. */
    (function () {
      var orig = SF.Quests.openLog;
      if (!orig || orig.__ojo) return;
      var w = function () {
        OJ.expireTick();
        decorateForUI();
        return orig.apply(this, arguments);
      };
      w.__ojo = true;
      copyFlags(orig, w);
      SF.Quests.openLog = w;
    })();

    /* onKill: hunt counting + silent-running enforcement (runs after the
     * base chain and the other phases' wraps). */
    (function () {
      var orig = SF.Quests.onKill;
      if (!orig || orig.__ojk) return;
      var w = function (e) {
        var r = orig.apply(this, arguments);
        try { OJ.onKill(e); } catch (err) { /* never break kills */ }
        return r;
      };
      w.__ojk = true;
      copyFlags(orig, w);
      SF.Quests.onKill = w;
    })();

    /* travelTo: jump refresh (deferred — main.js loads after quests.js).
     * Chains with the wormhole/hazard wraps on the same function. */
    (function () {
      if (!SF.Game || !SF.Game.travelTo || SF.Game.travelTo.__ojt) return;
      var orig = SF.Game.travelTo.bind(SF.Game);
      var w = function (systemId) {
        var r = orig.apply(this, arguments);
        try { if (window.SF && SF.OddJobs) SF.OddJobs.onJump(SF.Game.systemId); }
        catch (e) { /* never break jumps */ }
        return r;
      };
      w.__ojt = true;
      copyFlags(SF.Game.travelTo, w); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
      SF.Game.travelTo = w;
    })();

    /* nearSecret: per-frame scout proximity (deferred — secrets.js loads
     * after quests.js; chains on top of the lifepod __lpc wrap). */
    (function () {
      var S = window.SF && SF.Secrets;
      if (!S || !S.nearSecret || S.nearSecret.__ojn) return;
      var orig = S.nearSecret.bind(S);
      var w = function (player, systemId) {
        installWraps();
        try { if (window.SF && SF.OddJobs) SF.OddJobs.scoutTick(player, systemId); }
        catch (e) { /* never break the frame */ }
        return orig(player, systemId);
      };
      w.__ojn = true;
      copyFlags(S.nearSecret, w); // freeze-hunt-1: unbound fn (see ensureS2Wraps note)
      S.nearSecret = w;
    })();

    _installed = true;
  }

  installWraps();
  if (typeof setTimeout === 'function') setTimeout(installWraps, 50);
})();

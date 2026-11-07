/* ============================================================
 * STARFALL — Phase 4: Station NPCs
 *
 * SF.Dialogue: a tiny shared dialogue-tree runner.
 * SF.NPCs: cantina section in the station with
 *   - Zed the bartender (rumors hinting at quests/secrets)
 *   - Okafor the shipwright (flavor + one-time 20% repair discount)
 *   - Recruiter Vane (faction standings + pledge choices)
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function $(id) { return document.getElementById(id); }

  /* ---------------- shared dialogue tree ---------------- */
  var Dialogue = {
    // spec: {title, text, choices: [{label, run}] } — empty choices = just CLOSE
    open: function (spec) {
      if (window.SF && SF.Audio && SF.Audio.dialogue) SF.Audio.dialogue();
      var body = $('dialogue-body');
      body.innerHTML = '';
      var t = document.createElement('h2');
      t.textContent = spec.title;
      body.appendChild(t);
      var txt = document.createElement('div');
      txt.className = 'dlg-text';
      txt.textContent = spec.text;
      body.appendChild(txt);
      (spec.choices || []).forEach(function (ch) {
        var b = document.createElement('button');
        b.className = 'btn big dlg-choice ui-block';
        b.textContent = ch.label;
        b.addEventListener('click', function () { ch.run(); });
        body.appendChild(b);
      });
      var close = document.createElement('button');
      close.className = 'btn big ui-block';
      close.textContent = (spec.choices && spec.choices.length) ? 'LEAVE' : 'CLOSE';
      close.addEventListener('click', function () { Dialogue.close(); });
      body.appendChild(close);
      SF.Game.showOverlay('overlay-dialogue');
    },
    close: function () { SF.Game.hideOverlay('overlay-dialogue'); }
  };
  SF.Dialogue = Dialogue;

  /* ---------------- NPCs ---------------- */
  var RUMORS = [
    'Word is the Compact pays steady for pirate kills. Check the quest board, captain.',
    'Drifters say there\\u2019s rich ore past Ember Row — bring an escort.',
    'Saw Saskia the Storm drinking here once. Costs a fortune, fights like one.',
    'A freighter captain swears an Ember patrol went hostile near the rim. Watch your scope.',
    'Old Okafor fixes hulls cheap if you do him a kindness first. He\\u2019s proud, mind.',
    'Karma follows you out there. Stations charge shady captains extra — heard it myself.'
  ];

  var NPCs = {

    dialogue: function (spec) { Dialogue.open(spec); },

    renderCantina: function (body) {
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = 'CANTINA'; body.appendChild(h);
      var self = this;
      [
        { id: 'zed', name: 'Zed — Bartender', desc: 'Knows every rumor on the station.' },
        { id: 'okafor', name: 'Okafor — Shipwright', desc: 'Repairs, refits, and tall tales.' },
        { id: 'vane', name: 'Recruiter Vane', desc: 'Speaks for the factions. Pledges welcome.' }
      ].forEach(function (n) {
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name">' + n.name + '</div>' +
          '<div class="store-desc">' + n.desc + '</div></div></div>' +
          '<button class="btn store-btn">TALK</button>';
        row.querySelector('button').addEventListener('click', function () {
          self.talk(n.id);
        });
        body.appendChild(row);
      });
    },

    talk: function (id) {
      if (id === 'zed') this._zed();
      else if (id === 'okafor') this._okafor();
      else if (id === 'vane') this._vane();
    },

    _zed: function (leadId) {
      var self = this;
      var idx = Math.floor(Math.random() * RUMORS.length);
      var rumor = RUMORS[idx];
      // npc-voice-barks-wiring: zed_01..zed_06 mirror RUMORS order 1:1
      // (verified against phases/voice-pack-1/gen/lines.csv)
      var barkId = 'zed_0' + (idx + 1);
      if (leadId) SF.NPCVoice.playBarks([leadId, barkId]);
      else SF.NPCVoice.playBark(barkId);
      Dialogue.open({
        portrait: 'zed',
        title: 'Zed — Bartender 🍺',
        text: '\\u201C' + rumor + '\\u201D',
        choices: [
          { label: 'Buy Zed a drink (10cr) — another rumor', run: function () {
              if (SF.Player.credits >= 10) { SF.Player.credits -= 10; self._zed('zed_07'); }
              else { Dialogue.open({ title: 'Zed', text: 'Short on credits, huh? The rumors are free to the thirsty.', choices: [] }); }
            } },
          { label: 'Ask about work', run: function () {
              SF.NPCVoice.playBark('zed_08');
              Dialogue.open({ title: 'Zed', text: '\\u201CThe quest board\\u2019s your best bet. Factions post contracts there every time you dock.\\u201D', choices: [] });
            } }
        ]
      });
    },

    _okafor: function () {
      var discounted = SF.Player.shipwrightDiscount < 1;
      // npc-voice-barks-wiring: shipwright line
      SF.NPCVoice.playBark(discounted ? 'okafor_03' : 'okafor_01');
      Dialogue.open({
        portrait: 'okafor',
        title: 'Okafor — Shipwright 🔧',
        text: discounted
          ? '\\u201CYour discount\\u2019s still good, captain. Get that hull patched.\\u201D'
          : '\\u201CYou fly like my cousin — hard. Tell you what: do an old man a kindness and remember his name, and I\\u2019ll cut your next repair by a fifth. One time only.\\u201D',
        choices: discounted ? [] : [{
          label: '\\u201CYou\\u2019ve got a friend, Okafor.\\u201D (claim 20% repair discount)',
          run: function () {
            SF.Player.shipwrightDiscount = 0.8;
            if (SF.Factions) SF.Factions.shiftKarma(1);
            SF.NPCVoice.playBark('okafor_02');
            Dialogue.open({ title: 'Okafor', text: '\\u201CHeh. Kindness costs nothing and pays in hull plating.\\u201D', choices: [] });
          }
        }]
      });
    },

    _vane: function () {
      var self = this;
      var lines = SF.FACTION_LIST.map(function (f) {
        var v = SF.Factions.standing(f.id);
        return f.name + ': ' + (v >= 0 ? '+' : '') + v + ' (' + SF.Factions.stance(f.id) + ')';
      }).join('\\n');
      var karmaLine = '\\nKarma: ' + SF.Factions.karmaLabel() + ' (' + (SF.Factions.karma() >= 0 ? '+' : '') + SF.Factions.karma() + ')';
      // npc-voice-barks-wiring: recruiter greeting
      SF.NPCVoice.playBark('vane_01');
      Dialogue.open({
        portrait: 'vane',
        title: 'Recruiter Vane 🎖',
        text: '\\u201CThe factions watch every captain. Here\\u2019s where you stand:\\u201D\\n\\n' +
          lines + karmaLine +
          '\\n\\n\\u201CPledge yourself and I\\u2019ll put in a word. Words move standings, captain.\\u201D',
        choices: [
          { label: 'Pledge to the Solar Compact (+5 Compact, +2 karma)', run: function () {
              SF.Factions.shift('compact', 5); SF.Factions.shiftKarma(2); self._vaneDone('compact'); } },
          { label: 'Pledge to the Free Drifters (+5 Drifters)', run: function () {
              SF.Factions.shift('drifters', 5); self._vaneDone('drifters'); } },
          { label: 'Pledge to the Ember Pact (+5 Ember, −2 karma)', run: function () {
              SF.Factions.shift('ember', 5); SF.Factions.shiftKarma(-2); self._vaneDone('ember'); } },
          { label: '💬 Personal work — wingman contracts', run: function () { SF.NPCVoice.playBark('vane_02'); self._companionWork(); } }
        ]
      });
    },

    _vaneDone: function (fid) {
      SF.NPCVoice.playBark('vane_04'); // "Noted. They will hear of it."
      Dialogue.open({
        portrait: 'vane',
        title: 'Recruiter Vane 🎖',
        text: '\\u201CNoted. ' + SF.FACTION_BY_ID[fid].name + ' will hear of it.\\u201D',
        choices: []
      });
    }
  };

  SF.NPCs = NPCs;
})();

/* ============================================================
 * planets-facilities phase: SF.Bar — the expanded ground bar.
 *
 * Zed-style barkeeps on every bar planet: drinks & rumors,
 * "Sixes & Stars" dice gambling, and an information market
 * (intel that moves the game: derelict locations, bounty tips,
 * rich claims). Uses the shared SF.Dialogue tree.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var KEEPERS = [
    { name: 'Mara', q: 'wipes a glass that was never dirty' },
    { name: 'Old Pell', q: 'counts your credits before you sit down' },
    { name: 'Sable', q: 'slides you a menu with no prices' },
    { name: 'Grin', q: 'is already laughing at your next bet' }
  ];

  function keeperFor(pl) {
    var h = 0;
    for (var i = 0; i < pl.id.length; i++) h = (h * 31 + pl.id.charCodeAt(i)) % KEEPERS.length;
    return KEEPERS[h];
  }

  function d6() { return 1 + Math.floor(Math.random() * 6); }

  var Bar = {

    open: function (pl) {
      var k = keeperFor(pl);
      var self = this;
      // npc-voice-barks-wiring: keeper greeting bark (mara/pell/sable/grin)
      var KEEPER_BARK = { 'Mara': 'mara_01', 'Old Pell': 'pell_01', 'Sable': 'sable_01', 'Grin': 'grin_01' };
      if (KEEPER_BARK[k.name]) SF.NPCVoice.playBark(KEEPER_BARK[k.name]);
      SF.Dialogue.open({
        title: '\uD83C\uDF7A ' + k.name + ' — ' + pl.name + ' bar',
        text: '\u201C' + k.q.charAt(0).toUpperCase() + k.q.slice(1) +
          '. Welcome to ' + pl.name + ', captain. Drink, dice, or secrets — pick your poison.\u201D',
        choices: [
          { label: 'Buy a round (10cr) — hear a rumor', run: function () { self.drink(pl); } },
          { label: '\uD83C\uDFB2 Play Sixes & Stars (dice)', run: function () { self.diceBet(pl); } },
          { label: '\uD83D\uDD75 Buy information', run: function () { self.infoMarket(pl); } }
        ]
      });
    },

    drink: function (pl) {
      var self = this;
      if (SF.Player.credits < 10) {
        SF.NPCVoice.playBark('bar_07'); // "Short on credits, huh?..."
        SF.Dialogue.open({ title: keeperFor(pl).name, text: '\u201CShort on credits, huh? The rumors are free to the thirsty.\u201D', choices: [] });
        return;
      }
      SF.Player.credits -= 10;
      var R = [
        'Word is the Compact pays steady for pirate kills. Check the quest board, captain.',
        'Drifters say there\u2019s rich ore past Ember Row \u2014 bring an escort.',
        'Saw Saskia the Storm drinking here once. Costs a fortune, fights like one.',
        'A freighter captain swears an Ember patrol went hostile near the rim. Watch your scope.',
        'Old Okafor fixes hulls cheap if you do him a kindness first. He\u2019s proud, mind.',
        'Karma follows you out there. Stations charge shady captains extra \u2014 heard it myself.',
        'They say Deadlight\u2019s quiet fleet isn\u2019t a story. Nobody who checked came back to argue.',
        'The black market on ' + pl.name + ' moves fast. Buy low, sell before the sweep.',
        'Heard the wire\u2019s been busy. Bounty claims, standing shifts \u2014 the sector\u2019s awake.',
        'Faction HQs sell gear you can\u2019t get anywhere else. Earn their trust first.'
      ];
      var ri = Math.floor(Math.random() * R.length);
      var drinkRumor = R[ri];
      // npc-voice-barks-wiring: bar_01..bar_03 mirror the matching rumor lines;
      // other rumors get a rotating bar bark
      var rbark = drinkRumor.indexOf('black market') >= 0 ? 'bar_01'
        : drinkRumor.indexOf('Faction HQs') >= 0 ? 'bar_02'
        : drinkRumor.indexOf('wire\u2019s been busy') >= 0 ? 'bar_03'
        : 'bar_0' + (1 + (ri % 4));
      SF.NPCVoice.playBark(rbark);
      SF.Dialogue.open({
        title: '\uD83C\uDF7A ' + keeperFor(pl).name,
        text: '\u201C' + drinkRumor + '\u201D',
        choices: [{ label: 'Another round (10cr)', run: function () { self.drink(pl); } }]
      });
    },

    diceBet: function (pl) {
      var self = this;
      SF.NPCVoice.playBark('dice_01');
      SF.Dialogue.open({
        title: '\uD83C\uDFB2 Sixes & Stars',
        text: 'Two dice each. High roll takes the pot \u2014 ties push. ' + keeperFor(pl).name +
          ' never cheats. Probably.',
        choices: [25, 100, 500].map(function (bet) {
          return { label: 'Bet ' + bet + 'cr', run: function () { self.diceRoll(pl, bet); } };
        })
      });
    },

    diceRoll: function (pl, bet) {
      var self = this;
      if (SF.Player.credits < bet) {
        SF.Dialogue.open({ title: '\uD83C\uDFB2 Sixes & Stars', text: '\u201CCan\u2019t cover that bet, captain.\u201D', choices: [] });
        return;
      }
      SF.Player.credits -= bet;
      var you = d6() + d6(), house = d6() + d6();
      var txt = 'You roll ' + you + '. House rolls ' + house + '. ';
      if (you > house) {
        SF.Player.credits += bet * 2;
        txt += '\u201CYou take it!\u201D +' + (bet * 2) + 'cr.';
        SF.Audio.credit && SF.Audio.credit();
      } else if (you < house) {
        txt += '\u201CHouse takes it. Luck\u2019s a fickle copilot.\u201D';
      } else {
        SF.Player.credits += bet;
        txt += '\u201CPush. Your ' + bet + 'cr back.\u201D';
      }
      SF.Save.save();
      // npc-voice-barks-wiring: dice outcome bark
      SF.NPCVoice.playBark(you > house ? 'dice_02' : you < house ? 'dice_03' : 'dice_04');
      SF.Dialogue.open({
        title: '\uD83C\uDFB2 Sixes & Stars — ' + you + ' vs ' + house,
        text: txt,
        choices: [{ label: 'Roll again', run: function () { self.diceBet(pl); } }]
      });
    },

    /* Information market: three intel offers, one purchase each per visit. */
    infoMarket: function (pl) {
      var self = this;
      SF.NPCVoice.playBark('bar_06'); // "Knowledge is the only cargo..."
      var items = this._intelOffers(pl);
      var choices = items.map(function (it) {
        return {
          label: it.label + ' — ' + it.cost + 'cr',
          run: function () { self.buyIntel(pl, it); }
        };
      });
      SF.Dialogue.open({
        title: '\uD83D\uDD75 Information for sale',
        text: '\u201CKnowledge is the only cargo that never gets impounded, captain.\u201D',
        choices: choices
      });
    },

    _intelOffers: function (pl) {
      var offers = [];
      // 1: nearest uninvestigated derelict -> waypoint
      var target = null;
      if (window.SF && SF.Secrets && SF.Secrets.derelictsHere) {
        var list = SF.Secrets.derelictsHere(SF.Game.systemId);
        if (list && list.length) target = list[0];
      }
      if (target) offers.push({
        id: 'derelict', label: 'Derelict coordinates (' + target.name + ')', cost: 250, data: target,
        blurb: 'A wreck drifting in ' + SF.SYSTEM_BY_ID[SF.Game.systemId].name + ', full of salvage nobody\u2019s claimed.'
      });
      // 2: bounty target tip
      var b = (window.SF && SF.Bounty && SF.Bounty.active && SF.Bounty.active()) || null;
      if (b) offers.push({
        id: 'bounty', label: 'Bounty tip: ' + b.name, cost: 400, data: b,
        blurb: 'Last seen in the ' + SF.SYSTEM_BY_ID[b.system].name + ' system. The wire pays for confirmed kills.'
      });
      // 3: rich claim -> waypoint to a random asteroid
      offers.push({
        id: 'claim', label: 'Rich ore claim coordinates', cost: 150,
        blurb: 'An unmined cluster in this system. First come, first served.'
      });
      return offers;
    },

    buyIntel: function (pl, it) {
      var self = this;
      if (SF.Player.credits < it.cost) {
        SF.Dialogue.open({ title: keeperFor(pl).name, text: '\u201CInformation costs, captain. Come back with credits.\u201D', choices: [] });
        return;
      }
      SF.Player.credits -= it.cost;
      var done = '';
      if (it.id === 'derelict' && it.data) {
        SF.Game.waypoint = { systemId: SF.Game.systemId, x: it.data.x, y: it.data.y,
          label: it.data.name, mission: 'intel' };
        done = 'Coordinates marked on your scope. \u201C' + it.data.name + '\u201D won\u2019t stay unclaimed long.';
      } else if (it.id === 'bounty' && it.data) {
        SF.Game.waypoint = { systemId: it.data.system, x: SF.CONFIG.worldSize / 2, y: SF.CONFIG.worldSize / 2,
          label: 'Bounty: ' + it.data.name, mission: 'intel' };
        SF.HUD.toast('Bounty tip: last seen in ' + SF.SYSTEM_BY_ID[it.data.system].name);
        done = '\u201C' + it.data.name + ' was spotted in ' + SF.SYSTEM_BY_ID[it.data.system].name +
          '. Happy hunting.\u201D';
      } else if (it.id === 'claim') {
        var al = (window.SF && SF.Asteroids && SF.Asteroids.list) || [];
        var a = al[Math.floor(Math.random() * Math.max(1, al.length))];
        if (a) {
          SF.Game.waypoint = { systemId: SF.Game.systemId, x: a.x, y: a.y, label: 'Rich claim', mission: 'intel' };
          done = '\u201CRich rock, marked on your scope. Don\u2019t tell the miners I sent you.\u201D';
        } else done = '\u201CThe belt\u2019s picked clean today. Keep your credits.\u201D';
      }
      // npc-voice-barks-wiring: intel-category bark
      SF.NPCVoice.playBark(it.id === 'derelict' ? 'info_01' : it.id === 'bounty' ? 'info_02' : 'info_03');
      if (window.SF && SF.News) SF.News.push('\uD83D\uDD75 Word on ' + pl.name + ': a captain bought information. Something\u2019s moving.');
      SF.Save.save();
      SF.Dialogue.open({ title: '\uD83D\uDD75 ' + keeperFor(pl).name, text: done, choices: [] });
    }
  };

  SF.Bar = Bar;
})();
/* ============================================================
 * companion-quests phase: companion personal-chain dialogue text
 * (6 companions x 3 stages: offer / accept / complete lines) and
 * Recruiter Vane's "personal work" listing, which offers each
 * hired companion's next stage through the shared dialogue tree.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  SF.NPCs.CQUEST_TEXT = {
    rook: [
      { offer: 'Pirates raided my old freighter run, captain. The lane\u2019s gone quiet since \u2014 the wrong kind of quiet. Thin them out and I\u2019ll owe you.',
        accept: 'Good. Fly mean out there.',
        complete: 'Lane\u2019s clean. You fly like you mean it, captain.' },
      { offer: 'My rig eats salvage like it\u2019s going out of style. Six parts, captain \u2014 scrounge them and I\u2019m back at full tune.',
        accept: 'I\u2019ll make her purr again.',
        complete: 'She sings now. You\u2019re a friend of the freighter life.' },
      { offer: 'One more pass down the old lane, captain. I\u2019m making the run, you fly cover. Pirates know this route \u2014 expect company.',
        accept: 'Stay on my wing. Let\u2019s finish this.',
        complete: 'That lane\u2019s mine again. Whatever sky you fly, Rook flies with you.' }
    ],
    vex: [
      { offer: 'Three pirates jumped me in the Drift and left me venting atmo. They\u2019re still out there. Make them regret it.',
        accept: 'Try not to get vaporized, cap\u2019n.',
        complete: 'Heard the Drift went quiet. That was you. Nice.' },
      { offer: 'I\u2019m hauling something the raiders really want. They\u2019ll hit me the moment I undock \u2014 fly cover and make them pay for trying.',
        accept: 'Keep your trigger warm.',
        complete: 'Cargo\u2019s through. You\u2019re quicker than you look, captain.' },
      { offer: 'Their whole pack nests past Ember Row \u2014 the ones who\u2019ve been bleeding the lanes dry. Burn it down. All of it.',
        accept: 'Let\u2019s hunt.',
        complete: 'The pack\u2019s scattered. Vex doesn\u2019t forget who flies with her.' }
    ],
    bram: [
      { offer: 'Navy days are done, captain. Twelve ore, honest work \u2014 bring it to the station and an old man eats this week.',
        accept: 'For honest work, then.',
        complete: 'Good weight to it. You\u2019ve got a worker\u2019s hands.' },
      { offer: 'Pirates press a Compact lane I used to patrol. I can\u2019t let that stand. Answer it, captain \u2014 for the old colors.',
        accept: 'For the Compact\u2019s memory.',
        complete: 'The lane holds. The navy would\u2019ve saluted you.' },
      { offer: 'My old navy skiff needs a refit \u2014 eight salvage parts. Help an old man keep flying, and I\u2019ll never forget it.',
        accept: 'She\u2019ll fly again.',
        complete: 'She runs like she\u2019s twenty again. Bram\u2019s yours, captain \u2014 always.' }
    ],
    juno: [
      { offer: 'Fly my wing through the Drift run, captain. Undock when ready \u2014 raiders shadow this route. Watch the flanks.',
        accept: 'Formation on me.',
        complete: 'Clean flying. You hold a wing like you were born to it.' },
      { offer: 'Ember raiders probe our flank and I\u2019m short on guns. Meet them head-on \u2014 six hulls, no quarter.',
        accept: 'Weapons free.',
        complete: 'Textbook. The Ember war taught me well \u2014 and you better.' },
      { offer: 'Their carrier group is massing past Ember Row. Break it before it breaks the lanes. This is the big one, captain.',
        accept: 'Then we end it.',
        complete: 'Decisive. Fly close, captain \u2014 watch me work, always.' }
    ],
    nyx: [
      { offer: '\u2026they listen through the static, captain. Five of them. Silence them, and the static quiets.',
        accept: '\u2026static\u2026 acknowledged.',
        complete: '\u2026quieter now. You hear it too.' },
      { offer: '\u2026the hull drinks ore. Twenty. Feed it, and it remembers you kindly.',
        accept: '\u2026it will drink.',
        complete: '\u2026it remembers. So does Nyx.' },
      { offer: '\u2026two shadows tail me past Ember Row. Undock \u2014 burn them bright, and the static ends.',
        accept: '\u2026bright, then.',
        complete: '\u2026silence. Payment up front, loyalty after \u2014 you\u2019ve earned both.' }
    ],
    saskia: [
      { offer: 'Six raiders, Ember Row. They\u2019ve been telling stories about me. Show them the Storm, captain.',
        accept: 'Fly close. Watch me work.',
        complete: 'Ha! They\u2019ll tell that story for years.' },
      { offer: 'My legend needs upkeep \u2014 ten salvage parts. Legends don\u2019t fly on fumes, captain.',
        accept: 'The Storm provides.',
        complete: 'She gleams. You keep a legend flying, captain.' },
      { offer: 'The whole Ember Row pack \u2014 every hull that ever doubted me. Bring me their silence. This is the one they\u2019ll sing about.',
        accept: 'Then we give them a song.',
        complete: 'THE STORM. Come find me any sky, captain \u2014 I\u2019m yours.' }
    ]
  };

  /* Recruiter Vane: "personal work" listing for hired wingmen.
   * Called from the _vane dialogue (base edit adds the choice). */
  SF.NPCs._companionWork = function () {
    var self = this;
    var CQ = SF.CompanionQuests;
    var hired = (SF.Companions && SF.Companions.hired()) || [];
    var choices = [];
    hired.forEach(function (id) {
      if (id === 'hushed') return; /* hidden companion has no personal chain */
      var def = SF.Companions.byId[id];
      if (!def) return;
      var stage = CQ.stageOf(id);
      var T = SF.NPCs.CQUEST_TEXT[id];
      if (!T) return;
      if (stage >= 3) {
        choices.push({ label: def.name + ' \u2014 chain complete \u2764\u2605\u2605\u2605', run: function () {
          self.dialogue({ portrait: id, title: def.name,
            text: '\u201C' + T[2].complete + '\u201D\n\n' + def.name + ' flies at your side, loyal to the end.',
            choices: [] });
        } });
        return;
      }
      var active = CQ.activeFor(id);
      var sdef = CQ.chains[id][stage];
      if (active) {
        choices.push({ label: def.name + ' \u2014 ' + active.name + ' (in progress)', run: function () {
          self.dialogue({ title: active.name,
            text: '\u201C' + T[stage].accept + '\u201D\n\nProgress: ' + active.progress + '/' + active.n +
              '\nTurn in at: ' + active.station.split(':')[1],
            choices: [] });
        } });
        return;
      }
      choices.push({ label: '\uD83D\uDCAC ' + def.name + ' \u2014 ' + sdef.title, run: function () {
        self.dialogue({
          portrait: id,
          title: def.name + ' \u2014 ' + sdef.title,
          text: '\u201C' + T[stage].offer + '\u201D\n\n' + sdef.brief + '\nReward: ' + sdef.reward + 'cr',
          choices: [{
            label: 'Accept the job',
            run: function () {
              if (CQ.offerStage(id)) {
                self.dialogue({ title: def.name, text: '\u201C' + T[stage].accept + '\u201D', choices: [] });
                if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
              }
            }
          }]
        });
      } });
    });
    if (!choices.length) {
      this.dialogue({ portrait: 'vane', title: 'Recruiter Vane \uD83C\uDF96',
        text: '\u201CNo wingmen on your roster, captain. Hire some first \u2014 then they\u2019ll have work for you.\u201D',
        choices: [] });
      return;
    }
    this.dialogue({
      title: 'Wingman contracts',
      text: '\u201CYour wingmen fly their own errands, captain. Personal work, personal pay \u2014 and they\u2019ll remember who helped.\u201D',
      choices: choices
    });
  };
})();

/* ============================================================
 * companion-gear phase: SF.CompanionGear — equipment slots for
 * hired companions (2 slots each: weapon + armor).
 *
 * Gear is bought with credits, crafted from salvage parts, or
 * looted from kills (4% via an additive SF.Enemies.kill wrap).
 * Weapon gear adds flat +% wingman damage on top of the
 * companion-quests loyalty multiplier; armor gear adds flat
 * hull/sec regen on top of the loyalty regen tick.
 *
 * SAVE-NEUTRAL: fitted slots + owned inventory live inside the
 * existing companionState (P.companions) object under the additive
 * keys `gear` ({compId: {weapon, armor}}) and `gearInv`
 * ({gearId: count}). ship.js serialize() already deep-copies the
 * whole companions blob, so no SF.SAVE_VERSION bump is needed.
 * Defensive reads everywhere — old saves simply have no gear.
 *
 * No base-file edits: damage/regen/render/loot integration is all
 * additive wraps (flag __cg so double-loads stay idempotent).
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function cs() { return SF.Player.companionState; }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }

  function totalSalvage() {
    return Object.keys(SF.Player.partInventory || {}).reduce(function (a, k) {
      return a + (SF.Player.partInventory[k] || 0);
    }, 0);
  }
  function consumeSalvage(n) {
    var need = n, inv = SF.Player.partInventory || {};
    Object.keys(inv).forEach(function (k) {
      var take = Math.min(inv[k], need);
      inv[k] -= take; need -= take;
      if (inv[k] <= 0) delete inv[k];
    });
  }

  var Gear = {
    defs: SF.COMP_GEAR,
    byId: SF.COMP_GEAR_BY_ID,

    /* owned, unfitted gear: {gearId: count} */
    inv: function () {
      var c = cs();
      if (!c.gearInv) c.gearInv = {};
      return c.gearInv;
    },

    /* fitted slots: {compId: {weapon: gearId|null, armor: gearId|null}} */
    slots: function (id) {
      var c = cs();
      if (!c.gear) c.gear = {};
      if (!c.gear[id]) c.gear[id] = { weapon: null, armor: null };
      return c.gear[id];
    },

    equipped: function (id, slot) {
      var s = this.slots(id);
      return s[slot] || null;
    },

    /* additive bonuses (flat percentages / hull-per-sec) */
    dmgAdd: function (id) {
      var d = this.byId[this.equipped(id, 'weapon')];
      return (d && d.bonus && d.bonus.dmg) || 0;
    },
    regenAdd: function (id) {
      var d = this.byId[this.equipped(id, 'armor')];
      return (d && d.bonus && d.bonus.regen) || 0;
    },

    /* ---- acquire ---- */
    buy: function (gearId) {
      var d = this.byId[gearId];
      if (!d) return false;
      if (SF.Player.credits < d.price) { toast('Not enough credits.'); return false; }
      SF.Player.credits -= d.price;
      var inv = this.inv();
      inv[gearId] = (inv[gearId] || 0) + 1;
      toast('Bought ' + d.name + ' — fit it to a wingman below.');
      save();
      return true;
    },

    craft: function (gearId) {
      var d = this.byId[gearId];
      if (!d) return false;
      if (totalSalvage() < d.craftParts) {
        toast('Need ' + d.craftParts + ' salvage parts to fabricate.');
        return false;
      }
      consumeSalvage(d.craftParts);
      var inv = this.inv();
      inv[gearId] = (inv[gearId] || 0) + 1;
      toast('Fabricated ' + d.name + ' from salvage.');
      save();
      return true;
    },

    /* loot roll: tier-weighted random gear id */
    rollDrop: function () {
      var w = (window.SF && SF.CONFIG && SF.CONFIG.gearDropWeights) ||
        { white: 55, green: 27, blue: 13, purple: 5 };
      var pool = [];
      (SF.COMP_GEAR || []).forEach(function (g) {
        var n = w[g.tier] || 0;
        for (var i = 0; i < n; i++) pool.push(g.id);
      });
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    },

    /* ---- fit ---- */
    equip: function (compId, gearId) {
      var d = this.byId[gearId];
      if (!d) return false;
      if (!SF.Companions || !SF.Companions.isHired(compId)) { toast('Wingman not hired.'); return false; }
      var inv = this.inv();
      if ((inv[gearId] || 0) <= 0) { toast('You don\'t own that gear.'); return false; }
      var s = this.slots(compId);
      var slot = d.slot;
      var cur = s[slot];
      if (cur === gearId) return true; // already fitted
      if (cur) inv[cur] = (inv[cur] || 0) + 1; // swap the old piece back
      inv[gearId]--;
      if (inv[gearId] <= 0) delete inv[gearId];
      s[slot] = gearId;
      var def = SF.Companions.byId[compId];
      toast(def.name + ' equipped ' + d.name + '.');
      if (window.SF && SF.Audio && SF.Audio.mod) SF.Audio.mod(); // sfx-hooks-v34b-retry: gear_equip
      save();
      return true;
    },

    unequip: function (compId, slot) {
      var s = this.slots(compId);
      var cur = s[slot];
      if (!cur) return false;
      var inv = this.inv();
      inv[cur] = (inv[cur] || 0) + 1;
      s[slot] = null;
      var def = SF.Companions.byId[compId];
      toast(def.name + ' stowed ' + this.byId[cur].name + '.');
      if (window.SF && SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack(); // sfx-hooks-v34b-retry: gear_unequip
      save();
      return true;
    },

    /* ---- outfitter UI: appended to the hire UI by the renderHire wrap.
     * Gear panels sit right under the hire rows, each showing the
     * companion's loyalty stars next to their two equipment slots. ---- */
    renderOutfitter: function (body) {
      var hired = (SF.Companions && SF.Companions.hired()) || [];
      if (!hired.length) return;
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = '⚙ COMPANION OUTFITTER'; body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'store-desc';
      note.style.margin = '4px 0 8px';
      note.textContent = 'Two slots per wingman: weapon (+damage) and armor (+regen), ' +
        'stacking additively with loyalty. Buy, fabricate from salvage, or loot from kills.';
      body.appendChild(note);
      var self = this;
      hired.forEach(function (compId) {
        var def = SF.Companions.byId[compId];
        if (!def) return;
        var row = document.createElement('div');
        row.className = 'store-row';
        var wg = self.equipped(compId, 'weapon'), ag = self.equipped(compId, 'armor');
        var wline = wg ? '<b style="color:' + self.byId[wg].color + '">' + self.byId[wg].name + '</b> (+' +
            Math.round(self.byId[wg].bonus.dmg * 100) + '% dmg)' : '<i>EMPTY</i>';
        var aline = ag ? '<b style="color:' + self.byId[ag].color + '">' + self.byId[ag].name + '</b> (+' +
            self.byId[ag].bonus.regen.toFixed(2) + ' hull/s)' : '<i>EMPTY</i>';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name"><span class="comp-portrait">' + def.portrait + '</span>' +
          def.name + ' ' + SF.Companions.loyaltyStars(compId) + '</div>' +
          '<div class="store-desc">⚔ Weapon: ' + wline + (wg ? ' <button class="btn store-btn" data-cg="uneq-w">STOW</button>' : '') +
          '<br>🛡 Armor: ' + aline + (ag ? ' <button class="btn store-btn" data-cg="uneq-a">STOW</button>' : '') +
          '</div></div></div>';
        row.querySelectorAll('button[data-cg]').forEach(function (b) {
          b.addEventListener('click', function () {
            self.unequip(compId, b.getAttribute('data-cg') === 'uneq-w' ? 'weapon' : 'armor');
            if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
          });
        });
        body.appendChild(row);
        /* shop + fit rows for every gear piece */
        var inv = self.inv();
        self.defs.forEach(function (g) {
          var srow = document.createElement('div');
          srow.className = 'store-row';
          var owned = inv[g.id] || 0;
          var fitted = wg === g.id || ag === g.id;
          var btns = '';
          if (!fitted && owned <= 0) {
            btns = '<button class="btn store-btn" data-cg="buy">BUY ' + g.price + 'c</button>' +
                   '<button class="btn store-btn" data-cg="craft">MAKE ' + g.craftParts + ' salvage</button>';
          } else if (owned > 0 && !fitted) {
            btns = '<button class="btn store-btn" data-cg="fit">FIT ×' + owned + '</button>';
          } else {
            btns = '<span class="store-desc" style="color:#3ddc5f">FITTED</span>';
          }
          srow.innerHTML =
            '<div class="store-info"><div><div class="store-name">' + (g.slot === 'weapon' ? '⚔ ' : '🛡 ') +
            '<span style="color:' + g.color + '">' + g.name + '</span>' +
            ' <span style="color:' + (SF.TIERS[g.tier] || '#fff') + '">● ' + g.tier.toUpperCase() + '</span></div>' +
            '<div class="store-desc">' + g.desc + '</div></div></div>' + btns;
          srow.querySelectorAll('button[data-cg]').forEach(function (b) {
            var act = b.getAttribute('data-cg');
            b.addEventListener('click', function () {
              var ok = act === 'buy' ? self.buy(g.id)
                    : act === 'craft' ? self.craft(g.id)
                    : self.equip(compId, g.id);
              if (ok && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
            });
          });
          body.appendChild(srow);
        });
      });
    }
  };

  SF.CompanionGear = Gear;

  /* ---- damage integration: additive on top of the loyalty multiplier ----
   * quests.js: SF.Projectiles.spawn(..., def.dps * 0.9 *
   *   SF.Companions.loyaltyDmgMul(w.id), ...). Gear adds flat points:
   *   loyalty 2 (+6%) + sidearm (+6%) = 1.12x. */
  (function () {
    if (!SF.Companions || !SF.Companions.loyaltyDmgMul || SF.Companions.loyaltyDmgMul.__cg) return;
    var orig = SF.Companions.loyaltyDmgMul;
    var w = function (id) {
      var base = orig.call(this, id) || 1;
      return base + SF.CompanionGear.dmgAdd(id);
    };
    w.__cg = true;
    SF.Companions.loyaltyDmgMul = w;
  })();

  /* ---- regen integration: extra heal after the loyalty regen tick ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.loyaltyRegenTick || SF.Companions.loyaltyRegenTick.__cg) return;
    var orig = SF.Companions.loyaltyRegenTick;
    var w = function (dt) {
      orig.call(this, dt);
      var sum = 0;
      var act = this.active() || [];
      for (var i = 0; i < act.length; i++) sum += SF.CompanionGear.regenAdd(act[i].id);
      if (sum > 0 && SF.Game.state === 'PLAYING' && SF.Player.alive && SF.Player.hull > 0) {
        SF.Player.heal(sum * dt);
      }
    };
    w.__cg = true;
    SF.Companions.loyaltyRegenTick = w;
  })();

  /* ---- loot integration: 4% of kills drop a companion gear piece.
   * Chains after the companion-quests kill wrap (same additive pattern). ---- */
  (function () {
    var orig = SF.Enemies && SF.Enemies.kill;
    if (!orig || orig.__cg) return;
    var w = function (e) {
      var r = orig.apply(this, arguments);
      try {
        if (window.SF && SF.CompanionGear &&
            Math.random() < (SF.CONFIG.gearDropChance || 0.04)) {
          var drop = SF.CompanionGear.rollDrop();
          if (drop) {
            var inv = SF.CompanionGear.inv();
            inv[drop] = (inv[drop] || 0) + 1;
            toast('🎒 Looted: ' + SF.COMP_GEAR_BY_ID[drop].name + ' (companion gear)');
            save();
          }
        }
      } catch (err) { /* never break kills */ }
      return r;
    };
    w.__cg = true;
    SF.Enemies.kill = w;
  })();

  /* ---- UI integration: outfitter section appended after the hire rows ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.renderHire || SF.Companions.renderHire.__cg) return;
    var orig = SF.Companions.renderHire;
    var w = function (body) {
      orig.call(this, body);
      SF.CompanionGear.renderOutfitter(body);
    };
    w.__cg = true;
    SF.Companions.renderHire = w;
  })();
})();

/* ============================================================
 * npc-voice-barks-wiring phase: SF.NPCVoice bark engine + wraps.
 *
 * Bark engine: playBark(id) / playBarks(ids) — guarded
 *   SF.Audio.voice(id) (if (SF.Audio && SF.Audio.voice), try/catch;
 *   voice can never break the dialogue) + subtitle caption reusing
 *   campaign.js's #sf-voice-caption element if it already exists,
 *   else created lazily with the same pattern. Sequences chain via
 *   timer; a new playBark(s) call interrupts any in-flight sequence.
 *   Save-neutral: fire-and-forget, no persisted state, no
 *   SF.SAVE_VERSION bump. No signature changes anywhere.
 *
 * Wraps (additive, idempotent via __nvb, no base-file edits):
 *   - SF.Companions.hire: wingman bark on successful hire
 *     (rook->wingman_01, vex->wingman_02, juno->wingman_03,
 *      saskia->wingman_04; bram/nyx/hushed have no wingman bark).
 *   - SF.Quests.turnIn: contract_02 on successful contract turn-in.
 *   - SF.Station.dock: dock chatter (dock_01 at Haven, dock_02
 *     elsewhere) chained into the contract offer (contract_01).
 *   - SF.Station.undock: dock_03 ("Undocking. Mind the traffic...").
 *   Station wraps install deferred: station.js loads after npcs.js.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var VOICE_BARKS = {
    "zed_01": {"n": "ZED", "c": "#f5c542", "t": "Word is the Compact pays steady for pirate kills. Check the quest board, captain.", "d": 4.08},
    "zed_02": {"n": "ZED", "c": "#f5c542", "t": "Drifters say there's rich ore past Ember Row. Bring an escort.", "d": 3.29},
    "zed_03": {"n": "ZED", "c": "#f5c542", "t": "Saw Saskia the Storm drinking here once. Costs a fortune, fights like one.", "d": 4.15},
    "zed_04": {"n": "ZED", "c": "#f5c542", "t": "A freighter captain swears an Ember patrol went hostile near the rim. Watch your scope.", "d": 4.17},
    "zed_05": {"n": "ZED", "c": "#f5c542", "t": "Karma follows you out there. Stations charge shady captains extra. Heard it myself.", "d": 4.59},
    "zed_06": {"n": "ZED", "c": "#f5c542", "t": "They say Deadlight's quiet fleet isn't a story. Nobody who checked came back to argue.", "d": 4.14},
    "zed_07": {"n": "ZED", "c": "#f5c542", "t": "Another round? Ten credits. The rumors flow with the ale.", "d": 3.34},
    "zed_08": {"n": "ZED", "c": "#f5c542", "t": "The quest board's your best bet. Factions post contracts every time you dock.", "d": 3.82},
    "okafor_01": {"n": "OKAFOR", "c": "#e08d3c", "t": "You fly like my cousin. Hard. An old man can cut your repair bill, for a friend.", "d": 4.78},
    "okafor_02": {"n": "OKAFOR", "c": "#e08d3c", "t": "Kindness costs nothing, and pays in hull plating.", "d": 2.65},
    "okafor_03": {"n": "OKAFOR", "c": "#e08d3c", "t": "Get that hull patched before you fly. The black doesn't forgive.", "d": 3.38},
    "vane_01": {"n": "RECRUITER VANE", "c": "#ffd23f", "t": "The factions watch every captain. Pledge yourself, and I'll put in a word.", "d": 3.42},
    "vane_02": {"n": "RECRUITER VANE", "c": "#ffd23f", "t": "Words move standings, captain. Yours could move far.", "d": 2.81},
    "vane_03": {"n": "RECRUITER VANE", "c": "#ffd23f", "t": "The Compact, the Drifters, the Pact. Choose your gravity.", "d": 2.85},
    "vane_04": {"n": "RECRUITER VANE", "c": "#ffd23f", "t": "Noted. They will hear of it. Come back when you've made more of a name.", "d": 3.31},
    "mara_01": {"n": "MARA", "c": "#c9d4e3", "t": "Welcome to the bar, captain. Drink, dice, or secrets. Pick your poison.", "d": 5.1},
    "pell_01": {"n": "OLD PELL", "c": "#c9d4e3", "t": "Credits first, stories later. That's the house rule.", "d": 2.79},
    "sable_01": {"n": "SABLE", "c": "#c9d4e3", "t": "No prices on the menu. If you have to ask, you can't afford it.", "d": 4.15},
    "grin_01": {"n": "GRIN", "c": "#c9d4e3", "t": "Already laughing at your next bet, captain. Roll the bones!", "d": 3.0},
    "bar_01": {"n": "KEEPER", "c": "#c9d4e3", "t": "The black market moves fast. Buy low, sell before the sweep.", "d": 3.14},
    "bar_02": {"n": "KEEPER", "c": "#c9d4e3", "t": "Faction headquarters sell gear you can't get anywhere else. Earn their trust first.", "d": 4.97},
    "bar_03": {"n": "KEEPER", "c": "#c9d4e3", "t": "Heard the wire's been busy. Bounty claims, standing shifts. The sector's awake.", "d": 4.49},
    "bar_04": {"n": "KEEPER", "c": "#c9d4e3", "t": "A captain bought information here once. Something's moving out there.", "d": 4.16},
    "bar_05": {"n": "KEEPER", "c": "#c9d4e3", "t": "House takes the pot on ties. Nobody beats the house forever.", "d": 3.22},
    "bar_06": {"n": "KEEPER", "c": "#c9d4e3", "t": "Knowledge is the only cargo that never gets impounded, captain.", "d": 3.59},
    "bar_07": {"n": "KEEPER", "c": "#c9d4e3", "t": "Short on credits, huh? The rumors are free to the thirsty.", "d": 2.85},
    "bar_08": {"n": "KEEPER", "c": "#c9d4e3", "t": "Don't tell the miners I sent you. First come, first served.", "d": 4.2},
    "dice_01": {"n": "KEEPER", "c": "#c9d4e3", "t": "Two dice each. High roll takes the pot. I never cheat. Probably.", "d": 4.1},
    "dice_02": {"n": "KEEPER", "c": "#c9d4e3", "t": "You take it! Luck's a fine copilot today.", "d": 2.97},
    "dice_03": {"n": "KEEPER", "c": "#c9d4e3", "t": "House takes it. Luck's a fickle copilot.", "d": 2.42},
    "dice_04": {"n": "KEEPER", "c": "#c9d4e3", "t": "Push. Your credits back. The house is generous. Sometimes.", "d": 4.57},
    "info_01": {"n": "KEEPER", "c": "#c9d4e3", "t": "Derelict coordinates, marked on your scope. It won't stay unclaimed long.", "d": 3.64},
    "info_02": {"n": "KEEPER", "c": "#c9d4e3", "t": "Last seen in the Drift system. The wire pays for confirmed kills. Happy hunting.", "d": 5.51},
    "info_03": {"n": "KEEPER", "c": "#c9d4e3", "t": "Rich rock, marked. An unmined cluster. Go get it.", "d": 3.1},
    "dock_01": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "Haven Dock. Welcome home, captain. The lanes are quiet tonight.", "d": 3.51},
    "dock_02": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "Docking clamps engaged. Watch your step on the deck.", "d": 2.81},
    "dock_03": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "Undocking. Mind the traffic, and mind your karma.", "d": 2.75},
    "dock_04": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "Haven Dock control. Fly safe out there.", "d": 2.44},
    "wingman_01": {"n": "ROOK", "c": "#7fd4ff", "t": "Rook on your wing. Say the word, and I fly it.", "d": 2.63},
    "wingman_02": {"n": "VEX", "c": "#7fd4ff", "t": "Vex here. Try to keep up, captain.", "d": 2.87},
    "wingman_03": {"n": "JUNO", "c": "#7fd4ff", "t": "Juno, formation ready. Watch the flanks.", "d": 2.95},
    "wingman_04": {"n": "SASKIA", "c": "#7fd4ff", "t": "The Storm flies with you. Try not to embarrass me.", "d": 3.16},
    "contract_01": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "New contracts on the board. Factions pay for pirates, ore, and silence.", "d": 3.84},
    "contract_02": {"n": "HAVEN DOCK", "c": "#8fd0ff", "t": "Turn in your contracts at the station that posted them. The ledger is strict.", "d": 3.56}
  };

  var barkQueue = [];
  var barkTimer = null;

  function ensureCaption() {
    var el = document.getElementById('sf-voice-caption');
    if (el) return el; // campaign.js pattern: reuse the lazy caption if present
    el = document.createElement('div');
    el.id = 'sf-voice-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);' +
      'max-width:min(86vw,640px);padding:10px 14px;border-radius:10px;' +
      'background:rgba(4,8,18,.82);border:1px solid rgba(127,212,255,.35);' +
      'color:#eaf4ff;font:15px/1.45 system-ui,sans-serif;text-align:center;' +
      'z-index:9999;pointer-events:none;display:none;text-shadow:0 1px 2px #000;';
    document.body.appendChild(el);
    return el;
  }

  function hideCaption() {
    var el = document.getElementById('sf-voice-caption');
    if (el) el.style.display = 'none';
  }

  function pumpBark() {
    barkTimer = null;
    if (!barkQueue.length) { hideCaption(); return; }
    var id = barkQueue.shift();
    var b = VOICE_BARKS[id];
    try {
      if (b && window.SF && SF.Audio && SF.Audio.voice) SF.Audio.voice(id);
    } catch (err) { /* voice must never break the dialogue */ }
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
      barkTimer = setTimeout(pumpBark, Math.max(1200, b.d * 1000));
    } else {
      pumpBark(); // unknown id: skip ahead
    }
  }

  // Replace any in-flight bark sequence with ids (interrupt-safe).
  function playBarks(ids) {
    if (barkTimer) { clearTimeout(barkTimer); barkTimer = null; }
    barkQueue = (ids || []).slice();
    pumpBark();
  }
  function playBark(id) { playBarks([id]); }

  SF.NPCVoice = {
    playBark: playBark,
    playBarks: playBarks,
    hasBark: function (id) { return !!VOICE_BARKS[id]; },
    ids: function () { return Object.keys(VOICE_BARKS); },
    /* crew-chatter-wiring: merge a later phase's bark table in (additive;
     * existing ids win). Lets voice packs register without touching the
     * engine or its signatures. */
    registerBarks: function (table) {
      if (!table) return 0;
      var n = 0, id;
      for (id in table) {
        if (Object.prototype.hasOwnProperty.call(table, id) && !VOICE_BARKS[id]) {
          VOICE_BARKS[id] = table[id]; n++;
        }
      }
      return n;
    }
  };

  /* ---- hire event: wingman bark on successful hire ---- */
  (function () {
    if (!window.SF || !SF.Companions || !SF.Companions.hire || SF.Companions.hire.__nvb) return;
    var orig = SF.Companions.hire;
    var WINGMAN_BARK = { rook: 'wingman_01', vex: 'wingman_02', juno: 'wingman_03', saskia: 'wingman_04' };
    var w = function (id) {
      var ok = orig.apply(this, arguments);
      if (ok) {
        try {
          /* crew-chatter-wiring: rotating crew hire greetings (voice-pack-3)
           * take precedence once registered; wingman barks stay the
           * pre-registration fallback. Exactly one greeting per hire. */
          if (window.SF && SF.CrewVoice && SF.CrewVoice.hireBark) SF.CrewVoice.hireBark();
          else if (WINGMAN_BARK[id]) playBark(WINGMAN_BARK[id]);
        } catch (e) { /* never break hire */ }
      }
      return ok;
    };
    w.__nvb = true;
    SF.Companions.hire = w;
  })();

  /* ---- contract turn-in: contract_02 on success ---- */
  (function () {
    if (!window.SF || !SF.Quests || !SF.Quests.turnIn || SF.Quests.turnIn.__nvb) return;
    var orig = SF.Quests.turnIn;
    var w = function (questId) {
      var ok = orig.apply(this, arguments);
      if (ok) playBark('contract_02');
      return ok;
    };
    w.__nvb = true;
    SF.Quests.turnIn = w;
  })();

  /* ---- dock chatter + contract offer; undock line (deferred install) ---- */
  (function installStationWraps(tries) {
    tries = tries || 0;
    if (window.SF && SF.Station) {
      if (SF.Station.dock && !SF.Station.dock.__nvb) {
        var od = SF.Station.dock;
        var wd = function (st) {
          var r = od.apply(this, arguments);
          try {
            st = st || { name: 'Haven Dock', kind: 'dock' };
            if (st.kind === 'dock' || st.kind === 'homebase') {
              /* crew-chatter-wiring: rotating dock chatter (voice-pack-3)
               * once registered; dock_01/dock_02 stay the fallback. */
              var greet = (window.SF && SF.CrewVoice && SF.CrewVoice.dockBarkId) ?
                SF.CrewVoice.dockBarkId() :
                (/haven/i.test(st.name || '') ? 'dock_01' : 'dock_02');
              playBarks([greet, 'contract_01']);
            }
          } catch (e) { /* never break docking */ }
          return r;
        };
        wd.__nvb = true;
        SF.Station.dock = wd;
      }
      if (SF.Station.undock && !SF.Station.undock.__nvb) {
        var ou = SF.Station.undock;
        var wu = function () {
          var r = ou.apply(this, arguments);
          try { playBark('dock_03'); } catch (e) { /* never break undocking */ }
          return r;
        };
        wu.__nvb = true;
        SF.Station.undock = wu;
      }
    }
    var done = window.SF && SF.Station && SF.Station.dock && SF.Station.dock.__nvb &&
               SF.Station.undock && SF.Station.undock.__nvb;
    if (!done && tries < 240) setTimeout(function () { installStationWraps(tries + 1); }, 500);
  })();
})();
/* ============================================================
/* ============================================================
 * crew-morale phase: SF.CrewMorale — crew morale + wage system.
 * companion-crew-morale extension (same slug, second brief): morale pips,
 * combat-win / loyalty-stage / wingman-downed / ambush deltas, morale
 * bands with once-per-crossing banners.
 *
 * Additive on the phase-3 crew / companion-quests framework:
 * - morale 0..100 per hired companion, starts at 70, shown as pips next
 *   to the loyalty stars in the hire UI (and the gear outfitter)
 * - decays 1 point per 10 min of real PLAYING time
 * - combat win (non-elite kill that clears the board of combatants): +5
 * - +10 on any successful quest turn-in — loyalty-chain stages turn in
 *   through SF.Quests.turnIn, so stage completion is +10 by the same hook
 * - +15 on elite/boss kill (no combat-win bonus on the same kill)
 * - wingman downed (revived): -15 to every hired companion
 * - pirate trap ambush sprung (distress-trap, either spring path): -5
 * - wages: 200c per hired companion per 30 min of PLAYING time,
 *   payable at any station dock UI (PAY CREW line in the hire UI)
 * - MORALE BANDS: >= 80 morale-boosted: wingman damage +10%;
 *   <= 30 demoralized: wingman damage -15% (banner once per crossing);
 *   31..79 neutral. Bands stack additively with the companion-quest
 *   loyalty multiplier and the companion-gear flat bonus. Loyalty
 *   numbers are untouched.
 * - morale < 30 when docking: one warning; still < 30 at the next dock
 *   -> the companion deserts (dismissed from the roster)
 *
 * Save-neutral: morale / wagesOwed / desertWarned / the two time
 * accumulators live additively inside the existing P.companions blob,
 * which ship.js serialize() already deep-copies whole. No
 * SF.SAVE_VERSION bump. Defensive reads everywhere — old saves and
 * pre-phase hires simply default to 70.
 *
 * All integration is additive wraps (flags __cm original, __cm2 this
 * extension, idempotent):
 * - SF.Companions.hire: init morale 70 on successful hire
 * - SF.Companions.dismiss: clean up morale/warning records
 * - SF.Companions.update: per-frame decay + wage accrual (PLAYING only)
 * - SF.Companions.loyaltyDmgMul: morale damage modifier (chains under __cg)
 * - SF.Companions.loyaltyStars: morale pips appended (__cm2)
 * - SF.Quests.turnIn: +10 morale on success (chains under __cq/__sq/__skills)
 * - SF.Enemies.kill: +15 morale on elite/boss kill (chains under __cq/__cg);
 *   __cm2 outer wrap: combat-win +5 on board-clearing non-elite kills
 * - SF.Boarding.open (__cm2): pirate trap spring -> -5
 * - SF.EncountersVariety.springTrap (__cm2, deferred install): trap spring
 *   -> -5, deduped against the boarding hook via the distressTrap flag
 * - SF.Companions.renderHire: morale + PAY CREW panel (chains under __cg)
 * - SF.Station.dock: desertion warnings/desertions (deferred install —
 *   station.js loads after npcs.js; same pattern as the __nvb wraps)
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var MORALE_START = 70, MORALE_MIN = 0, MORALE_MAX = 100;
  var DECAY_INTERVAL = 600;      /* 1 morale per 10 min of PLAYING time */
  var WAGE_INTERVAL = 1800;      /* wages assessed per 30 min of PLAYING time */
  var WAGE_PER_COMPANION = 200;  /* credits per companion per wage interval */
  /* companion-crew-morale bands: >= 80 boosted (+10% wingman dmg),
   * <= 30 demoralized (-15% wingman dmg), else neutral. */
  var BOOST_AT = 80, BOOST_DMG = 0.10;
  var DEMORAL_AT = 30, DEMORAL_DMG = -0.15;
  var MORALE_LOW = 30;           /* desertion threshold (unchanged) */
  var RALLY_AT = 60;             /* crew-chatter-wiring rally-cry threshold (unchanged) */
  /* crew-chatter-wiring: rally-cry throttle so a multi-companion morale
   * bump (quest +10 / elite +15) yields one cry, not one per companion. */
  var RALLY_COOLDOWN_MS = 45000, lastRallyAt = 0;

  function cs() { return SF.Player.companionState; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toast(msg) { if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); }
  function save() { if (window.SF && SF.Save) SF.Save.save(); }
  function hiredIds() { return (SF.Companions && SF.Companions.hired()) || []; }
  function compName(id) {
    var def = (SF.Companions && SF.Companions.byId) ? SF.Companions.byId[id] : null;
    return def ? def.name : id;
  }
  /* big center banner for morale band crossings: lazily created,
   * pointer-transparent, auto-hides. Never throws. */
  var bannerEl = null, bannerTimer = null;
  function showBanner(html) {
    try {
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.id = 'sf-morale-banner';
        bannerEl.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);' +
          'padding:10px 22px;border-radius:12px;font:700 17px/1.35 system-ui,sans-serif;' +
          'color:#fff;background:rgba(8,14,30,.93);border:2px solid #7fd4ff;' +
          'box-shadow:0 0 26px rgba(127,212,255,.4);z-index:9999;pointer-events:none;' +
          'text-align:center;white-space:nowrap;display:none;';
        document.body.appendChild(bannerEl);
      }
      bannerEl.innerHTML = html;
      bannerEl.style.display = 'block';
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () {
        try { bannerEl.style.display = 'none'; } catch (e) { /* gone */ }
      }, 2600);
    } catch (e) { /* banner must never break the game */ }
  }

  function moraleMap() { var c = cs(); if (!c.morale) c.morale = {}; return c.morale; }
  function warnedMap() { var c = cs(); if (!c.desertWarned) c.desertWarned = {}; return c.desertWarned; }

  var Morale = {

    moraleOf: function (id) {
      var m = moraleMap();
      if (!(id in m)) return MORALE_START; /* pre-phase hires, granted companions */
      return clamp(m[id], MORALE_MIN, MORALE_MAX);
    },

    setMorale: function (id, v) {
      /* Band banners: once per crossing — only on ENTERING boosted (>=80)
       * or demoralized (<=30), never while staying inside or on leaving. */
      var old = this.moraleOf(id);
      var oldBand = this.bandOf(old);
      var nw = clamp(Math.round(v), MORALE_MIN, MORALE_MAX);
      moraleMap()[id] = nw;
      var newBand = this.bandOf(nw);
      if (newBand !== oldBand && (newBand === 'boosted' || newBand === 'demoralized')) {
        try { this.showBandBanner(id, newBand); } catch (e) { /* banner never breaks morale */ }
      }
      /* crew-chatter-wiring: rally cry when morale crosses RALLY_AT (60)
       * upward. Hire init (70->70) and decay (downward only) never cross. */
      if (old < RALLY_AT && nw >= RALLY_AT) {
        var now = Date.now();
        if (now - lastRallyAt > RALLY_COOLDOWN_MS) {
          lastRallyAt = now;
          try {
            if (window.SF && SF.CrewVoice && SF.CrewVoice.rallyBark) SF.CrewVoice.rallyBark();
          } catch (e) { /* never break morale */ }
        }
      }
      return nw;
    },

    /* additive wingman-damage modifier from this companion's morale.
     * Bands: >= 80 morale-boosted +10%; <= 30 demoralized -15%. */
    dmgAdd: function (id) {
      var m = this.moraleOf(id);
      if (m >= BOOST_AT) return BOOST_DMG;
      if (m <= DEMORAL_AT) return DEMORAL_DMG;
      return 0;
    },

    /* morale band of a 0..100 value: 'boosted' | 'neutral' | 'demoralized' */
    bandOf: function (m) {
      if (m >= BOOST_AT) return 'boosted';
      if (m <= DEMORAL_AT) return 'demoralized';
      return 'neutral';
    },

    /* apply a delta to every hired companion; returns {id: newMorale} */
    bumpAll: function (delta) {
      var out = {}, self = this;
      hiredIds().forEach(function (id) {
        out[id] = self.setMorale(id, self.moraleOf(id) + delta);
      });
      return out;
    },

    /* ---- time: decay + wage accrual over dt seconds of play.
     * Also the smoke-test entry point for forcing exact time deltas. ---- */
    _advance: function (dt) {
      var c = cs();
      var hired = hiredIds();
      var self = this;
      c.moraleDecayAcc = (c.moraleDecayAcc || 0) + dt;
      while (c.moraleDecayAcc >= DECAY_INTERVAL) {
        c.moraleDecayAcc -= DECAY_INTERVAL;
        hired.forEach(function (id) { self.setMorale(id, self.moraleOf(id) - 1); });
      }
      c.moraleWageAcc = (c.moraleWageAcc || 0) + dt;
      while (c.moraleWageAcc >= WAGE_INTERVAL) {
        c.moraleWageAcc -= WAGE_INTERVAL;
        c.wagesOwed = (c.wagesOwed || 0) + WAGE_PER_COMPANION * hired.length;
      }
    },

    _tick: function (dt) {
      if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
      if (!(dt > 0)) return;
      this._advance(dt);
    },

    /* ---- events ---- */
    onQuestTurnIn: function () {
      if (!hiredIds().length) return;
      this.bumpAll(10);
      toast('\u2764 Crew morale +10');
    },

    onEliteKill: function () {
      if (!hiredIds().length) return;
      this.bumpAll(15);
      toast('\uD83C\uDFC6 Elite down \u2014 crew morale +15');
    },

    /* -15 to every hired companion when a wingman is downed in combat
     * (revived afterwards — the scare, not the loss, hits morale).
     * NOTE: no live caller exists today — wingmen are untargetable by
     * design (enemies.js), so nothing can down one yet. A future
     * wingman-damage phase should call SF.CrewMorale.wingmanDown(id)
     * from its downed path; the hook, the delta, and the save handling
     * are implemented and smoke-tested here. */
    wingmanDown: function (id) {
      if (!hiredIds().length) return;
      this.bumpAll(-15);
      toast('\u2620 ' + compName(id) + ' is down \u2014 crew morale \u221215');
    },

    /* ---- combat win: +5 to every hired companion.
     * A combat win is a non-elite, non-boss kill that leaves no
     * combatants on the board (elite/boss kills pay +15 through
     * onEliteKill instead — no double-dip on the same kill). ---- */
    onCombatWin: function () {
      if (!hiredIds().length) return;
      this.bumpAll(5);
      toast('\u2694 Combat won \u2014 crew morale +5');
    },

    /* true when no combatants remain: traders and adrift wrecks are
     * never combatants, so a cleared pirate pack counts as a win. */
    boardCleared: function () {
      var list = (SF.Enemies && SF.Enemies.list) || [];
      for (var i = 0; i < list.length; i++) {
        if (!list[i].trader && !list[i].adrift) return false;
      }
      return true;
    },

    /* ---- pirate trap ambush sprung: -5 to every hired companion ---- */
    onAmbush: function () {
      if (!hiredIds().length) return;
      this.bumpAll(-5);
      toast('\u26a0 Pirate trap! Crew morale \u22125');
    },

    /* morale pips: 10 pips, filled = morale/10, colored by band.
     * Rendered next to the loyalty stars in companion UI. */
    pipsHTML: function (id) {
      var m = this.moraleOf(id);
      var filled = Math.round(m / 10), s = '', i;
      for (i = 0; i < 10; i++) s += (i < filled ? '\u25cf' : '\u25cb');
      var color = m >= BOOST_AT ? '#3ddc5f' : (m <= DEMORAL_AT ? '#ff5a5a' : '#f5c542');
      return '<span class="morale-pips" title="Morale ' + m + '%" style="color:' +
        color + ';letter-spacing:1px">' + s + '</span>';
    },

    /* big center banner for a band crossing (once per crossing) */
    showBandBanner: function (id, band) {
      var name = compName(id);
      if (band === 'boosted') {
        showBanner('\u2b06 ' + name + ' is <b>MORALE-BOOSTED</b> \u2014 wingman damage +10%');
      } else if (band === 'demoralized') {
        showBanner('\u2b07 ' + name + ' is <b>DEMORALIZED</b> \u2014 wingman damage \u221215%');
      }
    },

    /* ---- wages ---- */
    wagesOwed: function () { return cs().wagesOwed || 0; },

    payWages: function () {
      var owed = this.wagesOwed();
      if (owed <= 0) { toast('No wages owed. The crew is paid up.'); return { ok: false, paid: 0 }; }
      if (SF.Player.credits < owed) {
        toast('Not enough credits \u2014 crew wages: ' + owed + 'c.');
        /* crew-chatter-wiring: wage-due warning bark */
        try { if (window.SF && SF.CrewVoice && SF.CrewVoice.wageDueBark) SF.CrewVoice.wageDueBark(); } catch (e) {}
        return { ok: false, paid: 0 };
      }
      SF.Player.credits -= owed;
      cs().wagesOwed = 0;
      toast('\uD83D\uDCB0 Paid the crew ' + owed + 'c.');
      /* crew-chatter-wiring: payday bark */
      try { if (window.SF && SF.CrewVoice && SF.CrewVoice.wagesPaidBark) SF.CrewVoice.wagesPaidBark(); } catch (e) {}
      if (SF.Audio && SF.Audio.credit) SF.Audio.credit();
      save();
      return { ok: true, paid: owed };
    },

    /* ---- desertion: checked on every dock.
     * Returns true when the roster or warning state changed. ---- */
    onDock: function () {
      var hired = hiredIds().slice(); /* dismiss() mutates the live array */
      if (!hired.length) return false;
      var warned = warnedMap(), mm = moraleMap(), changed = false, self = this;
      hired.forEach(function (id) {
        var m = self.moraleOf(id);
        if (m < MORALE_LOW) {
          if (warned[id]) {
            SF.Companions.dismiss(id); /* also strips the active slot */
            delete mm[id]; delete warned[id];
            toast('\uD83D\uDEAA ' + compName(id) + ' has deserted (morale ' + m + '%).');
            /* crew-chatter-wiring: desertion bark */
            try { if (window.SF && SF.CrewVoice && SF.CrewVoice.desertedBark) SF.CrewVoice.desertedBark(); } catch (e) {}
            if (SF.Audio && SF.Audio.deny) SF.Audio.deny();
            changed = true;
          } else {
            warned[id] = true;
            toast('\u26A0 ' + compName(id) + ' is thinking of deserting (morale ' + m +
              '%). Raise it before the next dock.');
            /* crew-chatter-wiring: desertion-warning bark */
            try { if (window.SF && SF.CrewVoice && SF.CrewVoice.desertWarnBark) SF.CrewVoice.desertWarnBark(); } catch (e) {}
            changed = true;
          }
        } else if (warned[id]) {
          delete warned[id]; /* morale recovered — warning forgiven */
          changed = true;
        }
      });
      if (changed) save();
      return changed;
    },

    /* ---- hire-UI panel: morale rows + PAY CREW, appended after the
     * hire rows (and after the companion-gear outfitter section). ---- */
    renderCrewPanel: function (body) {
      var hired = hiredIds();
      var self = this, warned = warnedMap();
      var h = document.createElement('div'); h.className = 'store-head';
      h.textContent = '\u2764 CREW MORALE & WAGES'; body.appendChild(h);
      var note = document.createElement('div');
      note.className = 'store-desc';
      note.style.margin = '4px 0 8px';
      note.textContent = 'Morale 0\u2013100 (starts 70): decays slowly in flight; combat wins +5, ' +
        'quest turn-ins +10 (loyalty-chain stages included), elite/boss kills +15, ' +
        'wingman downed \u221215, pirate trap ambush \u22125. \u226580 morale-boosted: wingman ' +
        'damage +10%. \u226430 demoralized: wingman damage \u221215% (banner on crossing). ' +
        '<30 at dock: the companion may desert (one warning first). ' +
        'Wages: 200c per companion per 30 min of flight time \u2014 pay up at any dock.';
      body.appendChild(note);
      if (!hired.length) {
        var d = document.createElement('div');
        d.className = 'store-desc';
        d.textContent = 'No companions hired.';
        body.appendChild(d);
      }
      hired.forEach(function (id) {
        var def = SF.Companions.byId[id];
        if (!def) return;
        var m = self.moraleOf(id);
        var color = m >= BOOST_AT ? '#3ddc5f' : m > DEMORAL_AT ? '#f5c542' : '#ff5a5a';
        var status = warned[id]
          ? ' <span style="color:#ff5a5a">\u26A0 will desert if morale stays &lt;30</span>'
          : m >= BOOST_AT
            ? ' <span style="color:#3ddc5f">morale-boosted +10% dmg</span>'
            : m <= DEMORAL_AT ? ' <span style="color:#ff5a5a">demoralized \u221215% dmg</span>' : '';
        var row = document.createElement('div');
        row.className = 'store-row';
        row.innerHTML =
          '<div class="store-info"><div><div class="store-name"><span class="comp-portrait">' + def.portrait + '</span>' +
          def.name + '</div>' +
          '<div class="store-desc">Morale: <b style="color:' + color + '">' + m + '%</b>' + status + '</div>' +
          '</div></div>';
        body.appendChild(row);
      });
      /* PAY CREW row */
      var owed = this.wagesOwed();
      var prow = document.createElement('div');
      prow.className = 'store-row';
      prow.innerHTML =
        '<div class="store-info"><div><div class="store-name">\uD83D\uDCB0 PAY CREW</div>' +
        '<div class="store-desc">' + owed + 'c owed (' + hired.length + ' companion' +
        (hired.length === 1 ? '' : 's') + ' \u00D7 200c / 30 min)</div></div></div>' +
        '<button class="btn store-btn"' + (owed > 0 ? '' : ' disabled') + '>PAY ' + owed + 'c</button>';
      prow.querySelector('button').addEventListener('click', function () {
        var r = self.payWages();
        if (r.ok && SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      });
      body.appendChild(prow);
    }
  };

  SF.CrewMorale = Morale;

  /* ---- hire: init morale 70 on successful hire ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.hire || SF.Companions.hire.__cm) return;
    var orig = SF.Companions.hire;
    var w = function (id) {
      var ok = orig.apply(this, arguments);
      if (ok) { Morale.setMorale(id, MORALE_START); save(); }
      return ok;
    };
    w.__cm = true;
    SF.Companions.hire = w;
  })();

  /* ---- dismiss: clean up morale/warning records ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.dismiss || SF.Companions.dismiss.__cm) return;
    var orig = SF.Companions.dismiss;
    var w = function (id) {
      var r = orig.apply(this, arguments);
      try { delete moraleMap()[id]; delete warnedMap()[id]; } catch (e) { /* never break */ }
      return r;
    };
    w.__cm = true;
    SF.Companions.dismiss = w;
  })();

  /* ---- per-frame tick: decay + wage accrual (PLAYING only) ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.update || SF.Companions.update.__cm) return;
    var orig = SF.Companions.update;
    var w = function (dt) {
      var r = orig.apply(this, arguments);
      try { Morale._tick(dt); } catch (e) { /* never break the frame */ }
      return r;
    };
    w.__cm = true;
    SF.Companions.update = w;
  })();

  /* ---- damage: morale modifier stacks additively with loyalty + gear.
   * chains under the companion-gear (__cg) and formations wraps. ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.loyaltyDmgMul || SF.Companions.loyaltyDmgMul.__cm) return;
    var orig = SF.Companions.loyaltyDmgMul;
    var w = function (id) {
      var base = orig.call(this, id) || 1;
      return Math.max(0, base + Morale.dmgAdd(id));
    };
    w.__cm = true;
    SF.Companions.loyaltyDmgMul = w;
  })();

  /* ---- quest turn-in: +10 morale.
   * chains under the companion-quests (__cq), side-chains (__sq) and
   * skills (__skills) wraps — outermost, so deliver-quest turn-ins
   * (which return early inside __sq) still count. ---- */
  (function () {
    var orig = SF.Quests && SF.Quests.turnIn;
    if (!orig || orig.__cm) return;
    var w = function (questId) {
      var ok = orig.apply(this, arguments);
      if (ok) { try { Morale.onQuestTurnIn(); } catch (e) { /* never break */ } }
      return ok;
    };
    w.__cm = true;
    SF.Quests.turnIn = w;
  })();

  /* ---- elite/boss kill: +15 morale. chains under __cq/__cg. ---- */
  (function () {
    var orig = SF.Enemies && SF.Enemies.kill;
    if (!orig || orig.__cm) return;
    var w = function (e) {
      var r = orig.apply(this, arguments);
      try { if (e && (e.elite || e.boss)) Morale.onEliteKill(); } catch (err) { /* never break kills */ }
      return r;
    };
    w.__cm = true;
    SF.Enemies.kill = w;
  })();

  /* ---- hire UI: morale + PAY CREW panel. chains under the
   * companion-gear outfitter (__cg) wrap. ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.renderHire || SF.Companions.renderHire.__cm) return;
    var orig = SF.Companions.renderHire;
    var w = function (body) {
      var r = orig.apply(this, arguments);
      try { Morale.renderCrewPanel(body); } catch (e) { /* never break the store UI */ }
      return r;
    };
    w.__cm = true;
    SF.Companions.renderHire = w;
  })();

  /* ---- dock: desertion warnings/desertions.
   * Deferred install: station.js loads after npcs.js (same pattern as
   * the npc-voice-barks-wiring __nvb wraps). ---- */
  (function installDockWrap(tries) {
    tries = tries || 0;
    if (window.SF && SF.Station && SF.Station.dock && !SF.Station.dock.__cm) {
      var orig = SF.Station.dock;
      var w = function (st) {
        var r = orig.apply(this, arguments);
        try {
          if (Morale.onDock() && SF.Station.renderStore) SF.Station.renderStore();
        } catch (e) { /* never break docking */ }
        return r;
      };
      w.__cm = true;
      SF.Station.dock = w;
    }
    var done = window.SF && SF.Station && SF.Station.dock && SF.Station.dock.__cm;
    if (!done && tries < 240) setTimeout(function () { installDockWrap(tries + 1); }, 500);
  })();

  /* ============================================================
   * companion-crew-morale extension wraps (flag __cm2, idempotent).
   * Shares this IIFE's scope (Morale, hiredIds, toast, showBanner).
   * ============================================================ */

  /* ---- combat win: a non-elite, non-boss kill that leaves no
   * combatants on the board -> +5. Chains OUTSIDE the __cm elite/boss
   * wrap (installed above), so elite/boss kills keep their +15 with no
   * double-dip on the same kill. ---- */
  (function () {
    var orig = SF.Enemies && SF.Enemies.kill;
    if (!orig || orig.__cm2) return;
    var w = function (e) {
      var wasElite = !!(e && (e.elite || e.boss));
      var r = orig.apply(this, arguments);
      try {
        if (!wasElite && Morale.boardCleared()) Morale.onCombatWin();
      } catch (err) { /* never break kills */ }
      return r;
    };
    w.__cm2 = true;
    SF.Enemies.kill = w;
    /* install marker: later phases re-wrap kill without propagating flags,
     * so the __cm2 flag is not reliably visible on the outermost wrapper —
     * behavior (the combat-win test) is the real proof. */
    Morale._killHookInstalled = true;
  })();

  /* ---- pirate trap ambush, path 1: the base-game distress trap (50%)
   * springs inside SF.Boarding.open. boarding.js loads before npcs.js,
   * so a direct wrap is safe. Fires when e.distressTrap flips true->false. ---- */
  (function () {
    var orig = SF.Boarding && SF.Boarding.open;
    if (!orig || orig.__cm2) return;
    var w = function (e) {
      var wasTrap = !!(e && e.distressTrap);
      var r = orig.apply(this, arguments);
      try {
        if (wasTrap && e && !e.distressTrap) Morale.onAmbush();
      } catch (err) { /* never break boarding */ }
      return r;
    };
    w.__cm2 = true;
    SF.Boarding.open = w;
  })();

  /* ---- pirate trap ambush, path 2: the encounter-variety always-trap
   * springs via SF.EncountersVariety.springTrap (proximity / fired upon).
   * gameplay.js loads after npcs.js -> deferred install, same pattern as
   * the dock wrap. Deduped against path 1: if the boarding hook already
   * sprang this trap (distressTrap already false), the morale hit is
   * skipped while the game behavior still runs. ---- */
  (function installTrapWrap(tries) {
    tries = tries || 0;
    var V = window.SF && SF.EncountersVariety;
    if (V && V.springTrap && !V.springTrap.__cm2) {
      var orig = V.springTrap;
      var w = function (wreck) {
        var armed = !!(wreck && wreck.distressTrap);
        var r = orig.apply(this, arguments);
        try {
          if (armed && wreck && !wreck.distressTrap) Morale.onAmbush();
        } catch (err) { /* never break the trap */ }
        return r;
      };
      w.__cm2 = true;
      V.springTrap = w;
    }
    var done = window.SF && SF.EncountersVariety && SF.EncountersVariety.springTrap &&
      SF.EncountersVariety.springTrap.__cm2;
    if (!done && tries < 240) setTimeout(function () { installTrapWrap(tries + 1); }, 500);
  })();

  /* ---- morale pips next to the loyalty stars (hire UI + outfitter).
   * loyaltyStars is only ever called for hired companions, so unhired
   * rows never show pips. ---- */
  (function () {
    if (!SF.Companions || !SF.Companions.loyaltyStars || SF.Companions.loyaltyStars.__cm2) return;
    var orig = SF.Companions.loyaltyStars;
    var w = function (id) {
      var base = orig.call(this, id);
      try { return base + ' ' + Morale.pipsHTML(id); }
      catch (e) { return base; }
    };
    w.__cm2 = true;
    SF.Companions.loyaltyStars = w;
  })();
})();

/* ============================================================
 * portrait-wiring phase: show the shipped companion/NPC portraits
 * (assets/sprites/portraits/<id>.png, from companion-portraits) in
 * the dialogue UI and the companion hire UI.
 *
 * What it does, all additive inside js/npcs.js (no base edits):
 * 1. Warms the SF.Sprites cache for all 10 portrait ids at load, so
 *    panels render on first open.
 * 2. Wraps SF.Dialogue.open (flag __pw, idempotent): reads
 *    spec.portrait (explicit; several npcs.js specs now pass one) or
 *    infers a portrait id from the panel title for specs built by
 *    other phases' files (quests.js hire dialogs, contract offers),
 *    then prepends the speaker's portrait next to the panel title.
 *    When SF.Sprites.get returns null (still loading / missing), the
 *    panel stays exactly as before — text-only fallback intact.
 * 3. Wraps SF.Companions.renderHire (flag __pw, deferred install like
 *    the __nvb/__cm wraps, chains after the gear+morale panels): for
 *    every hire/outfitter row with a comp-portrait emoji span, swaps
 *    in the companion's PNG portrait (emoji kept as fallback).
 *
 * Save-neutral: nothing persisted, no SF.SAVE_VERSION bump.
 *
 * New SF.* API: SF.Portraits.ids(), .get(id)->HTMLImageElement|null,
 * .infer(spec)->id|null, .insertIntoDialog(body,spec)->bool.
 *
 * Out of scope (noted for a later phase): the black-market dealer
 * name is NOT renamed (blackmarket.js); 'mox' portrait has no
 * on-screen speaker yet. Contract offers (quests.js) and dock
 * chatter (station.js, voice-only today) get portraits automatically
 * once their callers pass portrait:/inferable titles in spec.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var PORTRAIT_IDS = ['zed', 'okafor', 'vane', 'rook', 'vex', 'bram',
                      'juno', 'nyx', 'saskia', 'mox',
                      /* portrait-pack-2 (portrait-wiring-2 phase): the 8 new
                       * NPC portrait ids shipped by portrait-pack-2. */
                      'announcer', 'broker', 'cartographer', 'fence',
                      'lifepod_civ', 'lifepod_pilot', 'smuggler', 'warlord'];

  /* ---- warm the portrait cache at load ---- */
  (function preloadPortraits(tries) {
    tries = tries || 0;
    if (window.SF && SF.Sprites && SF.Sprites.preload) {
      SF.Sprites.preload('portraits', PORTRAIT_IDS);
      return;
    }
    if (tries < 240) setTimeout(function () { preloadPortraits(tries + 1); }, 500);
  })();

  /* Fully-loaded <img> for a portrait id, or null on miss/loading.
   * Uses SF.Sprites.get('portraits', id) per the ASSETS.md contract. */
  function portraitImg(id) {
    try {
      if (!window.SF || !SF.Sprites || !SF.Sprites.get) return null;
      var img = SF.Sprites.get('portraits', id);
      if (!img) return null;
      var el = img.cloneNode(false); // cached: paints instantly
      el.className = 'dlg-portrait';
      el.style.cssText = 'width:112px;height:112px;border-radius:10px;object-fit:cover;' +
        'border:2px solid rgba(127,212,255,.45);background:rgba(4,8,18,.6);flex:0 0 auto;';
      el.alt = 'portrait:' + id;
      return el;
    } catch (e) { return null; }
  }

  /* Title -> portrait id, for specs that don't pass one explicitly
   * (hire dialogs + contract offers built by other phases' files).
   * Anchored on a lowercase title start so 'Zed — Bartender' and
   * 'Rook 🧑‍🚀' map, while 'Sixes & Stars' / bar keepers don't. */
  var TITLE_PORTRAIT = [
    ['zed', 'zed'], ['okafor', 'okafor'], ['recruiter vane', 'vane'],
    ['rook', 'rook'], ['vex', 'vex'], ['bram', 'bram'], ['juno', 'juno'],
    ['nyx', 'nyx'], ['saskia', 'saskia'],
    /* portrait-pack-2 (portrait-wiring-2 phase): title anchors for the
     * 8 new portraits. Anchors are lowercase title prefixes. */
    ['announcer', 'announcer'], ['arena announcer', 'announcer'],
    ['bounty broker', 'broker'],
    ['cartographer', 'cartographer'],
    ['black-market fence', 'fence'], ['fence', 'fence'],
    ['smuggler captain', 'smuggler'], ['smuggler', 'smuggler'],
    ['warlord', 'warlord'], ['📜 treaty talks', 'warlord'],
    ['🛟 distress beacon', 'lifepod_civ']
  ];
  function inferPortrait(spec) {
    if (spec && spec.portrait && PORTRAIT_IDS.indexOf(spec.portrait) >= 0) {
      return spec.portrait;
    }
    var t = String((spec && spec.title) || '').toLowerCase();
    for (var i = 0; i < TITLE_PORTRAIT.length; i++) {
      if (t.indexOf(TITLE_PORTRAIT[i][0]) === 0) return TITLE_PORTRAIT[i][1];
    }
    return null;
  }

  SF.Portraits = {
    ids: function () { return PORTRAIT_IDS.slice(); },
    get: portraitImg,
    infer: inferPortrait,
    insertIntoDialog: function (body, spec) {
      var pid = inferPortrait(spec);
      if (!pid) return false;
      var el = portraitImg(pid);
      if (!el || !body) return false;
      var h2 = body.querySelector('h2');
      if (!h2) return false;
      var wrap = document.createElement('div');
      wrap.className = 'dlg-speaker';
      wrap.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:10px;';
      h2.parentNode.insertBefore(wrap, h2);
      wrap.appendChild(el);
      wrap.appendChild(h2);
      return true;
    }
  };

  /* ---- dialogue wrap: speaker portrait next to the title ---- */
  (function () {
    if (!window.SF || !SF.Dialogue || !SF.Dialogue.open || SF.Dialogue.open.__pw) return;
    var orig = SF.Dialogue.open;
    var w = function (spec) {
      orig.call(this, spec);
      try {
        SF.Portraits.insertIntoDialog(document.getElementById('dialogue-body'), spec);
      } catch (e) { /* portrait must never break a dialogue */ }
    };
    w.__pw = true;
    SF.Dialogue.open = w;
  })();

  /* ---- hire UI wrap: PNG portraits in hire + outfitter rows ---- */
  function emojiToId() {
    var map = {};
    try {
      var byId = (window.SF && SF.Companions && SF.Companions.byId) || {};
      Object.keys(byId).forEach(function (id) {
        if (byId[id] && byId[id].portrait) map[byId[id].portrait] = id;
      });
    } catch (e) { /* map stays partial */ }
    return map;
  }
  function addHirePortraits(body) {
    if (!body || !body.querySelectorAll) return 0;
    var map = emojiToId(), n = 0;
    var spans = body.querySelectorAll('.comp-portrait');
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      if (span.getAttribute('data-pw')) continue; // already handled
      var id = map[span.textContent.trim()];
      if (!id) continue;
      var el = portraitImg(id);
      if (!el) continue; // loader miss/loading: keep the emoji
      el.style.cssText = 'width:40px;height:40px;border-radius:8px;object-fit:cover;' +
        'border:1px solid rgba(127,212,255,.4);vertical-align:middle;margin-right:8px;';
      el.className = 'comp-portrait-img';
      span.parentNode.insertBefore(el, span);
      span.setAttribute('data-pw', '1');
      span.style.display = 'none';
      n++;
    }
    return n;
  }
  (function installHireWrap(tries) {
    tries = tries || 0;
    if (window.SF && SF.Companions && SF.Companions.renderHire &&
        !SF.Companions.renderHire.__pw) {
      var orig = SF.Companions.renderHire;
      var w = function (body) {
        var r = orig.apply(this, arguments);
        try { addHirePortraits(body); } catch (e) { /* never break the store UI */ }
        return r;
      };
      w.__pw = true;
      SF.Companions.renderHire = w;
    }
    var done = window.SF && SF.Companions && SF.Companions.renderHire &&
               SF.Companions.renderHire.__pw;
    if (!done && tries < 240) setTimeout(function () { installHireWrap(tries + 1); }, 500);
  })();
})();

/* ============================================================
 * crew-chatter-wiring phase: wire voice-pack-3 crew/morale/outpost
 * barks into the game, in js/npcs.js ONLY.
 *
 * Bark ids (35, from phases/voice-pack-3-retry/VOICE-MANIFEST-3.md,
 * confirmed against phases/voice-pack-3/gen/lines.csv; durations measured
 * with ffprobe on the shipped OGGs — see gen/crew-chatter-table.py):
 *   crew_hired_01..05  hire greetings
 *   wage_paid_01..03   payday        wage_due_01..02   wage-due warning
 *   desert_warn_01..02 desertion warning   deserted_01..02   desertion
 *   rally_01..03       morale rally cries (cross 60 upward)
 *   form_delta/spear/spread_01..02  formation callouts
 *   outpost_dep_01..02 outpost deployed   turret_on_01..02  turret online
 *   probe_down_01..02  raid probe destroyed
 *   dock_chat_01..06   dock chatter
 *
 * Wiring (all additive, idempotent via __ccw, no signatures changed,
 * save-neutral — no SF.SAVE_VERSION bump):
 *   - SF.CrewVoice: bark API (hireBark, dockBarkId, wagesPaidBark,
 *     wageDueBark, desertWarnBark, desertedBark, rallyBark,
 *     formationBark, outpostBark, turretBark, probeDownBark, hasBark, ids).
 *     Playback reuses SF.NPCVoice (guarded SF.Audio.voice + the
 *     campaign.js #sf-voice-caption pattern); lines rotate round-robin
 *     per group so repeats don't drone.
 *   - SF.Companions.hire / SF.Station.dock: the existing __nvb wraps in
 *     this file prefer SF.CrewVoice greetings once registered (wingman /
 *     dock_01..02 stay the pre-registration fallback). Exactly one
 *     greeting per hire, one greeting (+contract_01) per dock.
 *   - SF.CrewMorale.payWages (this file): payday bark on success,
 *     wage-due warning bark when credits are short.
 *   - SF.CrewMorale.onDock (this file): desert_warn bark on warning,
 *     deserted bark on desertion.
 *   - SF.CrewMorale.setMorale (this file): rally cry when a companion's
 *     morale crosses 60 upward (45s cooldown).
 *   - SF.WingmanFormations.setFormation / cycleFormation (ship.js loads
 *     before npcs.js — direct wraps): formation callout for the new
 *     formation.
 *   - SF.Outposts.deploy / SF.OutpostUpgrades.buyTurret (gameplay.js
 *     loads after npcs.js — deferred install): outpost-deployed /
 *     turret-online barks on success.
 *   - SF.Enemies.kill (enemies.js loads before npcs.js — chains under
 *     the crew-morale __cm wrap): probe_down bark when a destroyed
 *     enemy is an outpost-raid probe (e.encounter === 'outpost-raid'),
 *     covering turret shootdowns and player kills en route.
 *
 * Known gap (noted, not dropped): a probe destroyed at point-blank
 * inside resolveRaid() (gameplay.js, closure-private) bypasses
 * SF.Enemies.kill, so no probe_down bark fires for that exact path —
 * the toast still shows. Wiring it would need a gameplay.js edit,
 * outside this phase's scope.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

// generated by gen/crew-chatter-table.py — do not hand-edit
var VOICE_PACK3 = {
  "crew_hired_01": {"n": "GUNNER", "c": "#ffd23f", "t": "Reporting for duty, captain. Gunner, five years on the drift. You won't regret this.", "d": 4.26},
  "crew_hired_02": {"n": "ROOK", "c": "#7fd4ff", "t": "You signed me? Ha! Best decision you ever made. Where do you want me, boss?", "d": 5.52},
  "crew_hired_03": {"n": "ENGINEER", "c": "#3fa9ff", "t": "Engineer at your service. Keep the reactor fed and she'll outrun anything out there.", "d": 5.04},
  "crew_hired_04": {"n": "MARINE", "c": "#ff5e3a", "t": "Marine. Point me at the problem and I'll make it go away quietly.", "d": 2.81},
  "crew_hired_05": {"n": "VET", "c": "#f5c542", "t": "So this is my new berth? Cozy. I'll earn my share, captain. Promise.", "d": 4.31},
  "wage_paid_01": {"n": "VET", "c": "#f5c542", "t": "Wages paid in full, crew. Drinks are on the house tonight.", "d": 2.86},
  "wage_paid_02": {"n": "GUNNER", "c": "#ffd23f", "t": "Four hundred credits, on the dot. You run a fair ship, captain.", "d": 3.05},
  "wage_paid_03": {"n": "PAYMASTER", "c": "#e8b34b", "t": "Payday! Morale's never been higher. We'd follow you anywhere.", "d": 3.35},
  "wage_due_01": {"n": "VET", "c": "#f5c542", "t": "Captain, wages are stacking up. Crew gets restless when the purse stays shut.", "d": 3.7},
  "wage_due_02": {"n": "PAYMASTER", "c": "#e8b34b", "t": "Two cycles owed and counting. You'd better settle up soon, boss.", "d": 3.27},
  "desert_warn_01": {"n": "GUNNER", "c": "#ffd23f", "t": "This is your last warning, captain. One more cold dock and I walk.", "d": 3.34},
  "desert_warn_02": {"n": "VET", "c": "#f5c542", "t": "The crew's talking about jumping ship. Pay up or wave goodbye.", "d": 3.08},
  "deserted_01": {"n": "MARINE", "c": "#ff5e3a", "t": "I've had it. Docking pay or not, I'm gone. Good luck flying short-handed.", "d": 3.77},
  "deserted_02": {"n": "PAYMASTER", "c": "#e8b34b", "t": "You let us down, captain. The crew's deserting. Don't say we didn't warn you.", "d": 3.63},
  "rally_01": {"n": "GUNNER", "c": "#ffd23f", "t": "For the crew! Weapons hot, shields up. Let's show them what we do!", "d": 3.43},
  "rally_02": {"n": "ROOK", "c": "#7fd4ff", "t": "Stay on my wing and fight dirty! Nobody dies today, you hear me?", "d": 4.22},
  "rally_03": {"n": "MARINE", "c": "#ff5e3a", "t": "We're outgunned, not outclassed! Hold formation and make every shot count!", "d": 3.41},
  "form_delta_01": {"n": "PAYMASTER", "c": "#e8b34b", "t": "Delta formation. Tight triangle, watch each other's six.", "d": 3.07},
  "form_delta_02": {"n": "ROOK", "c": "#7fd4ff", "t": "Going delta. Turtle up and let them break on us.", "d": 2.94},
  "form_spear_01": {"n": "GUNNER", "c": "#ffd23f", "t": "Spearhead! Wedge up and punch straight through them!", "d": 2.58},
  "form_spear_02": {"n": "MARINE", "c": "#ff5e3a", "t": "Spearhead on my mark. Hit hard, hit fast, don't stop.", "d": 2.99},
  "form_spread_01": {"n": "PAYMASTER", "c": "#e8b34b", "t": "Spread out! Wide line, light up your scanners, call every contact.", "d": 3.56},
  "form_spread_02": {"n": "ROOK", "c": "#7fd4ff", "t": "Spreading wide. Keep your distance and sweep the dark.", "d": 3.05},
  "outpost_dep_01": {"n": "VET", "c": "#f5c542", "t": "Outpost deployed and anchored. She's chewing rock already, captain.", "d": 3.29},
  "outpost_dep_02": {"n": "ENGINEER", "c": "#3fa9ff", "t": "Mining rig is live. Ore's flowing. Nice spot you picked.", "d": 4.08},
  "turret_on_01": {"n": "ENGINEER", "c": "#3fa9ff", "t": "Turret online. Anything with teeth gets a warm welcome now.", "d": 3.98},
  "turret_on_02": {"n": "SHIP AI", "c": "#8fd0ff", "t": "Station defense turret wired and tracking. Pirate deterrence: active.", "d": 4.84},
  "probe_down_01": {"n": "GUNNER", "c": "#ffd23f", "t": "Raid probe down! Splash one pirate scout. The outpost holds.", "d": 4.18},
  "probe_down_02": {"n": "SHIP AI", "c": "#8fd0ff", "t": "Hostile probe neutralized. That will teach them to poke around our rig.", "d": 4.42},
  "dock_chat_01": {"n": "SHIP AI", "c": "#8fd0ff", "t": "Welcome back to Haven Dock. Mind the new paint, we actually fixed something.", "d": 4.79},
  "dock_chat_02": {"n": "DOCK", "c": "#c9d4e3", "t": "Docking clamps engaged. Fuel lines are cheaper this week, lucky you.", "d": 4.49},
  "dock_chat_03": {"n": "ROOK", "c": "#7fd4ff", "t": "Heard you tangled with Ember raiders out there. Drinks later, hero?", "d": 4.05},
  "dock_chat_04": {"n": "DOCK", "c": "#c9d4e3", "t": "Cargo inspection's waived for regulars. Just don't make me regret it.", "d": 4.36},
  "dock_chat_05": {"n": "DOCK", "c": "#c9d4e3", "t": "They say the Drift's crawling with pirates again. Watch your six out there.", "d": 4.06},
  "dock_chat_06": {"n": "SHIP AI", "c": "#8fd0ff", "t": "Another safe landing! The old girl's holding together nicely, captain.", "d": 4.41}
};

  /* round-robin rotation per bark group */
  var ROT = {
    crew_hired: ['crew_hired_01', 'crew_hired_02', 'crew_hired_03', 'crew_hired_04', 'crew_hired_05'],
    wage_paid:  ['wage_paid_01', 'wage_paid_02', 'wage_paid_03'],
    wage_due:   ['wage_due_01', 'wage_due_02'],
    desert_warn:['desert_warn_01', 'desert_warn_02'],
    deserted:   ['deserted_01', 'deserted_02'],
    rally:      ['rally_01', 'rally_02', 'rally_03'],
    form_delta: ['form_delta_01', 'form_delta_02'],
    form_spearhead: ['form_spear_01', 'form_spear_02'],
    form_spread:['form_spread_01', 'form_spread_02'],
    outpost_dep:['outpost_dep_01', 'outpost_dep_02'],
    turret_on:  ['turret_on_01', 'turret_on_02'],
    probe_down: ['probe_down_01', 'probe_down_02'],
    dock_chat:  ['dock_chat_01', 'dock_chat_02', 'dock_chat_03',
                 'dock_chat_04', 'dock_chat_05', 'dock_chat_06']
  };
  var nextIdx = {};
  function nextIn(group) {
    var ids = ROT[group] || [];
    if (!ids.length) return null;
    var i = nextIdx[group] || 0;
    nextIdx[group] = (i + 1) % ids.length;
    return ids[i];
  }

  /* register the pack-3 table with the npc-voice-barks-wiring engine;
   * guarded so a missing engine can never break the phase. */
  var registered = 0;
  try {
    if (SF.NPCVoice && SF.NPCVoice.registerBarks) registered = SF.NPCVoice.registerBarks(VOICE_PACK3);
  } catch (e) { /* engine stays as-is */ }

  function playId(id) {
    try {
      if (id && window.SF && SF.NPCVoice && SF.NPCVoice.playBark) {
        SF.NPCVoice.playBark(id);
        return true;
      }
    } catch (e) { /* voice must never break the game */ }
    return false;
  }
  function bark(group) { return playId(nextIn(group)); }

  SF.CrewVoice = {
    registered: function () { return registered; },
    hasBark: function (id) { return !!(VOICE_PACK3[id]); },
    ids: function () { return Object.keys(VOICE_PACK3); },
    groups: function () { return Object.keys(ROT); },
    hireBark:      function () { return bark('crew_hired'); },
    dockBarkId:    function () { return nextIn('dock_chat'); },
    wagesPaidBark: function () { return bark('wage_paid'); },
    wageDueBark:   function () { return bark('wage_due'); },
    desertWarnBark:function () { return bark('desert_warn'); },
    desertedBark:  function () { return bark('deserted'); },
    rallyBark:     function () { return bark('rally'); },
    formationBark: function (formationId) {
      /* delta | spearhead | spread — matches SF.WINGMAN_FORMATIONS ids */
      return bark('form_' + formationId);
    },
    outpostBark:   function () { return bark('outpost_dep'); },
    turretBark:    function () { return bark('turret_on'); },
    probeDownBark: function () { return bark('probe_down'); }
  };

  /* ---- formation callouts: ship.js loads before npcs.js, direct wraps ---- */
  (function () {
    if (!window.SF || !SF.WingmanFormations) return;
    var WF = SF.WingmanFormations;
    if (WF.setFormation && !WF.setFormation.__ccw) {
      var os = WF.setFormation;
      var ws = function (slotIdx, id) {
        var ok = os.apply(this, arguments);
        if (ok) { try { if (SF.CrewVoice) SF.CrewVoice.formationBark(id); } catch (e) {} }
        return ok;
      };
      ws.__ccw = true;
      WF.setFormation = ws;
    }
    if (WF.cycleFormation && !WF.cycleFormation.__ccw) {
      var oc = WF.cycleFormation;
      var wc = function (slotIdx) {
        var next = oc.apply(this, arguments);
        if (next) { try { if (SF.CrewVoice) SF.CrewVoice.formationBark(next); } catch (e) {} }
        return next;
      };
      wc.__ccw = true;
      WF.cycleFormation = wc;
    }
  })();

  /* ---- outpost / turret barks: gameplay.js loads after npcs.js,
   * deferred install (same pattern as the __nvb / __cm station wraps) ---- */
  (function installOutpostWraps(tries) {
    tries = tries || 0;
    var ok = true;
    if (window.SF && SF.Outposts && SF.Outposts.deploy) {
      if (!SF.Outposts.deploy.__ccw) {
        var od = SF.Outposts.deploy;
        var wd = function (a) {
          var r = od.apply(this, arguments);
          if (r === true) { try { if (SF.CrewVoice) SF.CrewVoice.outpostBark(); } catch (e) {} }
          return r;
        };
        wd.__ccw = true;
        SF.Outposts.deploy = wd;
      }
    } else ok = false;
    if (window.SF && SF.OutpostUpgrades && SF.OutpostUpgrades.buyTurret) {
      if (!SF.OutpostUpgrades.buyTurret.__ccw) {
        var ob = SF.OutpostUpgrades.buyTurret;
        var wb = function (o) {
          var r = ob.apply(this, arguments);
          if (r === true) { try { if (SF.CrewVoice) SF.CrewVoice.turretBark(); } catch (e) {} }
          return r;
        };
        wb.__ccw = true;
        SF.OutpostUpgrades.buyTurret = wb;
      }
    } else ok = false;
    var done = window.SF && SF.Outposts && SF.Outposts.deploy && SF.Outposts.deploy.__ccw &&
               SF.OutpostUpgrades && SF.OutpostUpgrades.buyTurret && SF.OutpostUpgrades.buyTurret.__ccw;
    if (!done && tries < 240) setTimeout(function () { installOutpostWraps(tries + 1); }, 500);
  })();

  /* ---- raid-probe destroyed: chains under the crew-morale __cm wrap
   * (enemies.js loads before npcs.js, so the base exists already) ---- */
  (function () {
    var orig = window.SF && SF.Enemies && SF.Enemies.kill;
    if (!orig || orig.__ccw) return;
    var w = function (e) {
      var r = orig.apply(this, arguments);
      try {
        if (e && e.encounter === 'outpost-raid' && window.SF && SF.CrewVoice) {
          SF.CrewVoice.probeDownBark();
        }
      } catch (err) { /* never break kills */ }
      return r;
    };
    w.__ccw = true;
    SF.Enemies.kill = w;
  })();
})();

/* ============================================================
 * voice-wiring-v6 phase: pack-6 companion-quest turn-in voices.
 *
 * Additive, idempotent (__vw6) wrap of SF.CompanionQuests.onTurnedIn
 * (defined in js/quests.js, which loads before this file). After the
 * original turn-in bookkeeping: loyalty-maxed (chain complete) plays
 * cq_loyalmax_01; otherwise a random cq_turnin_01..03 turn-in line.
 * Guarded SF.Voice6.say/pick + caption; try/catch so voice can never
 * break the turn-in. Save-neutral: no blob changes, no
 * SF.SAVE_VERSION bump. No signature changes.
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  function install() {
    if (!window.SF || !SF.CompanionQuests ||
        typeof SF.CompanionQuests.onTurnedIn !== 'function' ||
        SF.CompanionQuests.onTurnedIn.__vw6) return false;
    var orig = SF.CompanionQuests.onTurnedIn;
    var w = function (q) {
      var r = orig.call(this, q);
      try {
        var id = q && q.cqId;
        var nm = 'WINGMAN', col = '#7fd4ff';
        try {
          var def = SF.Companions && SF.Companions.byId && SF.Companions.byId[id];
          if (def && def.name) nm = String(def.name).toUpperCase();
        } catch (e2) { /* name lookup is best-effort */ }
        var done = !!(SF.CompanionQuests && SF.CompanionQuests.stageOf(id) >= 3);
        if (window.SF && SF.Voice6 && SF.Voice6.say && SF.Voice6.pick) {
          if (done) SF.Voice6.say('cq_loyalmax_01', nm, col);
          else SF.Voice6.pick('cq_turnin', 3, nm, col);
        }
      } catch (e) { /* voice is best-effort */ }
      return r;
    };
    w.__vw6 = true;
    SF.CompanionQuests.onTurnedIn = w;
    return true;
  }

  /* quests.js loads before npcs.js, but install deferred anyway so the
   * wrap survives any future load-order change. */
  if (!install()) {
    var t = setInterval(function () { if (install()) clearInterval(t); }, 500);
  }
})();

/* ============================================================
 * portrait-wiring-2 phase: wire the 8 portrait-pack-2 portraits
 * (assets/sprites/portraits/{announcer,broker,cartographer,fence,
 *  lifepod_civ,lifepod_pilot,smuggler,warlord}.png) to their NPCs.
 *
 * NOTE on the brief: the pack-2 REPORT suggested setting portrait
 * fields on "existing" NPC defs, but no such defs existed in the
 * live tree (verified by grep: no announcer/fence/warlord/cartographer/
 * smuggler/broker NPC defs anywhere in js/). So this phase CREATES
 * the 8 NPC defs here in js/npcs.js — each carrying its own
 * `portrait: '<id>'` field — and wires them to the real systems:
 *
 *   announcer  -> SF.Arena gauntlets (TALK row added to the arena
 *                 store section via a guarded renderSection wrap)
 *   fence      -> black market (TALK row in the black-market panel
 *                 via a guarded SF.BlackMarket.open wrap)
 *   smuggler   -> black-market smuggling flows (TALK row, same wrap)
 *   warlord    -> faction treaty negotiation: the existing
 *                 '📜 Treaty talks' dialogue gets the warlord portrait
 *                 via a title anchor, and the warlord def offers
 *                 per-faction NEGOTIATE choices calling
 *                 SF.Factions.negotiate(fid)
 *   lifepod_civ/lifepod_pilot -> SF.RescueContracts: the '🛟 DISTRESS
 *                 BEACON' dialogue gets lifepod_civ via a title anchor;
 *                 the '🛟 NAME — GRATEFUL' recruit dialogue resolves
 *                 lifepod_pilot (3-star survivor) vs lifepod_civ by
 *                 matching the survivor name against the active
 *                 rescue contracts (Dialogue.open wrap, __pw2)
 *   cartographer -> wormhole cartographer NPC def (no wormhole UI
 *                 exists in the live tree yet; def + title anchor
 *                 are the hook for a later phase)
 *   broker     -> bounty broker def + SF.Bounty board summary
 *
 * All additive inside js/npcs.js (no base-file edits): extends the
 * pack-1 PORTRAIT_IDS / TITLE_PORTRAIT lists above (cache warm +
 * explicit-portrait/title inference), adds SF.NPCPack2 defs + talk(),
 * and installs three guarded, idempotent, try/catch-wrapped wraps.
 * Canvas-drawn fallback stays intact: every portrait render goes
 * through SF.Sprites.get('portraits', id), which returns null when
 * the file is missing/still loading — the dialogue panel then
 * renders exactly as before, text-only.
 *
 * Save-neutral: nothing persisted, no SF.SAVE_VERSION bump (stays v11).
 *
 * New SF.* API: SF.NPCPack2.defs, .talk(id)->bool, .ids().
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var PACK2_IDS = ['announcer', 'broker', 'cartographer', 'fence',
                   'lifepod_civ', 'lifepod_pilot', 'smuggler', 'warlord'];

  /* ---- warm the portrait cache at load (same pattern as pack-1) ---- */
  (function preloadPack2(tries) {
    tries = tries || 0;
    if (window.SF && SF.Sprites && SF.Sprites.preload) {
      SF.Sprites.preload('portraits', PACK2_IDS);
      return;
    }
    if (tries < 240) setTimeout(function () { preloadPack2(tries + 1); }, 500);
  })();

  function cr() { try { return Math.floor(SF.Player.credits) || 0; } catch (e) { return 0; } }
  function toast(msg) { try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {} }
  function closeDlg() { try { if (SF.Dialogue && SF.Dialogue.close) SF.Dialogue.close(); } catch (e) {} }

  function factionName(fid) {
    try {
      var f = (SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid]) || null;
      if (f && f.name) return f.name;
    } catch (e) {}
    return fid;
  }
  function factionIds() {
    try {
      if (SF.FACTION_LIST && SF.FACTION_LIST.length) {
        return SF.FACTION_LIST.map(function (f) { return f.id; });
      }
    } catch (e) {}
    return ['compact', 'drifters', 'ember'];
  }
  function factionLines() {
    var ids = factionIds(), out = [];
    for (var i = 0; i < ids.length; i++) {
      var st = '?';
      try { st = String(SF.Factions.standing(ids[i])); } catch (e) {}
      out.push(factionName(ids[i]) + ': ' + st);
    }
    return out.join(' · ');
  }

  function arenaLines() {
    try {
      var T = (SF.Arena && SF.Arena.tiers) || [];
      var parts = [];
      for (var i = 0; i < T.length; i++) {
        var pay = (SF.Arena.payoutFor) ? SF.Arena.payoutFor(i) : 0;
        parts.push(T[i].name + ' (' + T[i].waves + ' waves, purse ' + pay + 'c)');
      }
      return parts.join('\n');
    } catch (e) { return 'League data unavailable.'; }
  }
  function bountyLines() {
    try {
      var offers = (SF.Bounty && SF.Bounty.offers) ? SF.Bounty.offers() : [];
      var active = (SF.Bounty && SF.Bounty.active) ? SF.Bounty.active() : null;
      var out = [];
      if (active && active.name) out.push('ACTIVE: ' + active.name + ' — ' + (active.reward || 0) + 'c');
      for (var i = 0; i < offers.length; i++) {
        out.push('• ' + offers[i].name + ' — ' + (offers[i].reward || 0) + 'c');
      }
      return out.length ? out.join('\n') : 'No contracts posted right now.';
    } catch (e) { return 'Board unreachable.'; }
  }
  function rescueLines() {
    try {
      var acts = (SF.RescueContracts && SF.RescueContracts.active) ? SF.RescueContracts.active() : [];
      if (!acts.length) return 'No rescue contracts active.';
      return acts.map(function (q) {
        var sv = q.lpSurvivor || {};
        return '• ' + (sv.name || 'unknown') + ' (' + (sv.stars || '?') + '★ ' + (sv.role || '?') + ')';
      }).join('\n');
    } catch (e) { return 'Rescue board unreachable.'; }
  }

  /* ---- the 8 NPC defs, each with its portrait field ---- */
  var DEFS = {
    announcer: {
      name: 'Arena Announcer', title: '🎙 Arena Announcer', portrait: 'announcer',
      text: function () {
        return '“LADIES AND GENTLEMEN OF HAVEN DOCK! The leagues run hot tonight!”\n\n' +
          arenaLines() +
          '\n\n“Buy in at the COMBAT ARENA section. The crowd loves a captain who bleeds pretty.”';
      },
      choices: function () {
        return [{ label: '“We’ll see about that.”', run: function () { closeDlg(); } }];
      }
    },
    broker: {
      name: 'Bounty Broker', title: '🎯 Bounty Broker', portrait: 'broker',
      text: function () {
        return '“Contracts, captain. Fresh ones. I take a finder’s fee and you take the risk — ' +
          'everyone eats.”\n\n' + bountyLines() +
          '\n\n“Targets spawn in their home system once you sign. Finish your current mark first.”';
      },
      choices: function () {
        return [{ label: '“I’ll check the board.”', run: function () {
          closeDlg(); toast('Bounty contracts post on the quest board — BOUNTY section.');
        } }];
      }
    },
    cartographer: {
      name: 'Wormhole Cartographer', title: '🌀 Wormhole Cartographer', portrait: 'cartographer',
      text: function () {
        return '“I chart the holes between here and everywhere. The lanes shift, the math doesn’t.”\n\n' +
          '“One day I’ll sell you a transit map that skips three systems. One day. ' +
          'The holes aren’t stable enough yet — check back after the survey crews report in.”';
      },
      choices: function () {
        return [{ label: '“Keep me posted.”', run: function () { closeDlg(); } }];
      }
    },
    fence: {
      name: 'Black-Market Fence', title: '🕶 Black-Market Fence', portrait: 'fence',
      text: function () {
        return '“You didn’t get it from me, and I never saw you. That’s the whole business model.”\n\n' +
          '“Papers, parts, quiet jobs — browse the shelves. Everything here is… negotiable. ' +
          'The inspector never comes down this corridor.”';
      },
      choices: function () {
        return [{ label: '“Pleasure doing business.”', run: function () { closeDlg(); } }];
      }
    },
    lifepod_civ: {
      name: 'Lifepod Survivor', title: '🛟 Lifepod Survivor', portrait: 'lifepod_civ',
      text: function () {
        return '“You pulled me out of the dark. I was nobody’s priority — just a civilian ' +
          'on a bad vector.”\n\n' + rescueLines() +
          '\n\n“Deliver me to any station and the contract pays. That’s the deal, that’s the whole deal.”';
      },
      choices: function () {
        return [{ label: '“Hang on — we’re almost there.”', run: function () { closeDlg(); } }];
      }
    },
    lifepod_pilot: {
      name: 'Veteran Pilot Survivor', title: '🛟 Veteran Pilot', portrait: 'lifepod_pilot',
      text: function () {
        return '“Twenty years flying the lanes and I still ended up in a can with a strobe.”\n\n' +
          rescueLines() +
          '\n\n“Get me dirtside and I’ll fly wingman rates you won’t believe. A pilot remembers.”';
      },
      choices: function () {
        return [{ label: '“You’ve got a bunk, pilot.”', run: function () { closeDlg(); } }];
      }
    },
    smuggler: {
      name: 'Smuggler Captain', title: '🚀 Smuggler Captain', portrait: 'smuggler',
      text: function () {
        var jobs = 0;
        try { jobs = (SF.BLACKMARKET_JOBS || []).length; } catch (e) {}
        return '“The quiet lanes pay better than the loud ones. I run cargo the customs ' +
          'boys never see.”\n\n' +
          (jobs ? '“' + jobs + ' shady jobs on the board right now. Heat’s a cost of doing business.”'
                 : '“No jobs on the board right now — check back after the next dock.”');
      },
      choices: function () {
        return [{ label: '“Keep it quiet.”', run: function () { closeDlg(); } }];
      }
    },
    warlord: {
      name: 'Faction Warlord', title: '⚔ Faction Warlord', portrait: 'warlord',
      text: function () {
        return '“You want peace? Peace has a price. You want war? War has a receipt.”\n\n' +
          'Current standings — ' + factionLines() +
          '\n\n“Pick a table, captain. I’ll sit you down with their envoy.”';
      },
      choices: function () {
        var ids = factionIds(), out = [];
        ids.forEach(function (fid) {
          out.push({ label: 'Negotiate with ' + factionName(fid), run: function () {
            try {
              if (SF.Factions && SF.Factions.negotiate) { SF.Factions.negotiate(fid); return; }
            } catch (e) {}
            closeDlg(); toast('Treaty talks unavailable.');
          } });
        });
        out.push({ label: '“Another time.”', run: function () { closeDlg(); } });
        return out;
      }
    }
  };

  function talk(id) {
    var def = DEFS[id];
    if (!def) return false;
    if (!window.SF || !SF.Dialogue || !SF.Dialogue.open) return false;
    try {
      SF.Dialogue.open({
        portrait: def.portrait,
        title: def.title,
        text: def.text(),
        choices: def.choices()
      });
      return true;
    } catch (e) { return false; }
  }

  SF.NPCPack2 = {
    defs: DEFS,
    talk: talk,
    ids: function () { return PACK2_IDS.slice(); }
  };

  /* ---- lifepod pilot-vs-civ resolver: '🛟 NAME — GRATEFUL' ----
   * Matches the survivor name against the active rescue contracts;
   * a 3-star survivor gets the pilot portrait, anyone else the civ.
   * Falls back to lifepod_civ when no contract matches. Runs as the
   * OUTERMOST Dialogue.open wrap (__pw2) so the inner __pw wrap
   * picks up spec.portrait for insertion. */
  function lifepodPortraitFor(title) {
    try {
      var name = title.slice(3).split(' — ')[0].trim().toUpperCase();
      var acts = (SF.RescueContracts && SF.RescueContracts.active)
        ? SF.RescueContracts.active() : [];
      for (var i = 0; i < acts.length; i++) {
        var sv = acts[i] && acts[i].lpSurvivor;
        if (sv && String(sv.name || '').toUpperCase() === name) {
          return (sv.stars >= 3) ? 'lifepod_pilot' : 'lifepod_civ';
        }
      }
    } catch (e) { /* fall through to civ */ }
    return 'lifepod_civ';
  }
  (function installOpenWrap() {
    if (!window.SF || !SF.Dialogue || !SF.Dialogue.open || SF.Dialogue.open.__pw2) return;
    var origOpen = SF.Dialogue.open;
    var wo = function (spec) {
      try {
        spec = spec || {};
        if (!spec.portrait && spec.title) {
          var t = String(spec.title);
          if (t.indexOf('🛟 ') === 0 && t.toUpperCase().indexOf('GRATEFUL') > 0) {
            spec.portrait = lifepodPortraitFor(t);
          }
        }
      } catch (e) { /* portrait must never break a dialogue */ }
      return origOpen.call(this, spec);
    };
    wo.__pw2 = true;
    SF.Dialogue.open = wo;
  })();

  /* ---- store-section TALK rows: announcer in the arena section,
   * fence + smuggler in the black-market panel. Deferred install
   * because station.js / blackmarket.js load AFTER npcs.js. ---- */
  function addTalkRow(body, rowId, name, desc, npcId) {
    if (!body || !body.querySelector) return;
    if (body.querySelector('#' + rowId)) return; // already added
    var div = document.createElement('div');
    div.className = 'store-row';
    div.id = rowId;
    div.innerHTML = '<div class="store-info"><div><div class="store-name">' + name +
      '</div><div class="store-desc">' + desc + '</div></div></div>';
    var btn = document.createElement('button');
    btn.className = 'btn store-btn';
    btn.textContent = 'TALK';
    btn.addEventListener('click', function () { talk(npcId); });
    div.appendChild(btn);
    body.appendChild(div);
  }

  (function installSectionWraps(tries) {
    tries = tries || 0;
    var pending = false;

    if (window.SF && SF.Arena && SF.Arena.renderSection && !SF.Arena.renderSection.__pw2a) {
      var origArena = SF.Arena.renderSection;
      var wa = function (body, curSt) {
        var r = origArena.apply(this, arguments);
        try {
          addTalkRow(body, 'pw2-announcer-row', '🎙 ARENA ANNOUNCER',
            'Hype, odds, and league gossip.', 'announcer');
        } catch (e) { /* never break the store */ }
        return r;
      };
      wa.__pw2a = true;
      SF.Arena.renderSection = wa;
    } else if (!(window.SF && SF.Arena && SF.Arena.renderSection)) { pending = true; }

    if (window.SF && SF.BlackMarket && SF.BlackMarket.open && !SF.BlackMarket.open.__pw2b) {
      var origBM = SF.BlackMarket.open;
      var wb = function (site) {
        var r = origBM.apply(this, arguments);
        try {
          var body = document.getElementById('blackmarket-body');
          addTalkRow(body, 'pw2-fence-row', '🕶 BLACK-MARKET FENCE',
            'Moves anything. Asks nothing.', 'fence');
          addTalkRow(body, 'pw2-smuggler-row', '🚀 SMUGGLER CAPTAIN',
            'Runs the quiet lanes between stations.', 'smuggler');
        } catch (e) { /* never break the market */ }
        return r;
      };
      wb.__pw2b = true;
      SF.BlackMarket.open = wb;
    } else if (!(window.SF && SF.BlackMarket && SF.BlackMarket.open)) { pending = true; }

    if (pending && tries < 240) setTimeout(function () { installSectionWraps(tries + 1); }, 500);
  })();
})();

/* ============================================================
 * portrait-wiring-3 phase: wire the 8 portrait-pack-3 portraits
 * (assets/sprites/portraits/{envoy_compact,envoy_drifters,envoy_pact,
 *  informant,bookmaker,ghost_captain,drone_tech,salvage_broker}.png)
 * to their NPCs. RETRY of the portrait-wiring-3 attempt, which
 * produced screenshots but never filed a report and never merged;
 * the live tree was verified (grep) to wire NONE of these 8 ids.
 *
 * Hook points come from portrait-pack-3/REPORT.md "Notes for the
 * next phase", verified against the live tree (not invented):
 *   envoy_compact/drifters/pact -> faction treaty envoys:
 *     'TREATY talks — <faction>' (factions.js SF.Factions.negotiate),
 *     'Ceasefire talks — <faction>' (SF.Ceasefire.negotiateTalks),
 *     '<faction> envoy' defection dialogues (factions.js)
 *   informant     -> black-market informant (TALK row in the
 *                   black-market panel via a guarded
 *                   SF.BlackMarket.open wrap) — distinct from pack-2
 *                   'fence'
 *   bookmaker     -> arena bookmaker (TALK row in the arena store
 *                   section via a guarded SF.Arena.renderSection
 *                   wrap) — distinct from pack-2 'announcer'
 *   ghost_captain -> derelict/ghost-ship encounter (title anchor on
 *                   '☠ THE SILENT CHOIR', secrets.js Ghost._derelict)
 *   drone_tech    -> drone bay technician (TALK row on the crafting
 *                   workbench, drone owners only, via a guarded
 *                   SF.Crafting.renderWorkbench wrap; pairs with the
 *                   SF.Drone systems from salvage-drones)
 *   salvage_broker-> salvage broker (TALK row on the crafting
 *                   workbench; salvage-drones crafting flows)
 *
 * All additive inside js/npcs.js (no base-file edits). The pack-1
 * PORTRAIT_IDS/TITLE_PORTRAIT tables live in an earlier IIFE's
 * closure, so this phase extends the portrait machinery through
 * guarded wraps on SF.Portraits / SF.Dialogue.open:
 *   - cache warm: SF.Sprites.preload('portraits', PACK3_IDS)
 *   - SF.Dialogue.open wrap (__pw3, outermost): resolves a pack-3
 *     portrait id from spec.portrait (when in PACK3_IDS) or from
 *     the verified title anchors, and sets spec.portrait BEFORE
 *     the inner __pw/__pw2 wraps run.
 *   - SF.Portraits.insertIntoDialog wrap (__pw3i): inserts the
 *     pack-3 portrait first (same 112px dlg-portrait styling);
 *     defers to the original for all other ids. Pack-3 anchors are
 *     checked before the pack-1/2 tables, so e.g. 'Treaty talks —
 *     Solar Compact' gets envoy_compact, not the warlord anchor.
 * Canvas-drawn fallback stays intact: every render goes through
 * SF.Sprites.get('portraits', id), which returns null when the
 * file is missing/still loading — the dialogue panel then renders
 * exactly as before, text-only (verified by the deleted-portrait
 * probe in smoke.mjs).
 *
 * Save-neutral: nothing persisted, no SF.SAVE_VERSION bump (stays v11).
 *
 * New SF.* API: SF.NPCPack3.defs, .talk(id)->bool, .ids().
 * ============================================================ */
(function () {
  'use strict';

  var SF = window.SF = window.SF || {};

  var PACK3_IDS = ['envoy_compact', 'envoy_drifters', 'envoy_pact',
                   'informant', 'bookmaker', 'ghost_captain',
                   'drone_tech', 'salvage_broker'];

  /* ---- warm the portrait cache at load (same pattern as pack-1/2) ---- */
  (function preloadPack3(tries) {
    tries = tries || 0;
    if (window.SF && SF.Sprites && SF.Sprites.preload) {
      SF.Sprites.preload('portraits', PACK3_IDS);
      return;
    }
    if (tries < 240) setTimeout(function () { preloadPack3(tries + 1); }, 500);
  })();

  function cr() { try { return Math.floor(SF.Player.credits) || 0; } catch (e) { return 0; } }
  function toast(msg) { try { if (SF.HUD && SF.HUD.toast) SF.HUD.toast(msg); } catch (e) {} }
  function closeDlg() { try { if (SF.Dialogue && SF.Dialogue.close) SF.Dialogue.close(); } catch (e) {} }

  function factionName(fid) {
    try {
      var f = (SF.FACTION_BY_ID && SF.FACTION_BY_ID[fid]) || null;
      if (f && f.name) return f.name;
    } catch (e) {}
    return fid;
  }
  function factionStanding(fid) {
    try {
      if (SF.Factions && SF.Factions.standing) {
        var v = SF.Factions.standing(fid);
        return (v >= 0 ? '+' : '') + v;
      }
    } catch (e) {}
    return '?';
  }
  function droneOwned() {
    try {
      if (window.SF && SF.Drone && typeof SF.Drone.owned === 'function') {
        return SF.Drone.owned();
      }
    } catch (e) {}
    return 0;
  }
  function salvageCount() {
    try {
      var inv = (window.SF && SF.Player && SF.Player.partInventory) || {};
      return Object.keys(inv).reduce(function (a, k) { return a + (inv[k] || 0); }, 0);
    } catch (e) { return 0; }
  }
  function arenaLeagueLines() {
    try {
      var T = (SF.Arena && SF.Arena.tiers) || [];
      var parts = [];
      for (var i = 0; i < T.length; i++) {
        var pay = (SF.Arena.payoutFor) ? SF.Arena.payoutFor(i) : 0;
        parts.push(T[i].name + ' (' + T[i].waves + ' waves, purse ' + pay + 'c)');
      }
      if (parts.length) return parts.join('\n');
    } catch (e) {}
    return 'League boards are quiet tonight.';
  }

  /* ---- the 8 NPC defs, each with its portrait field ---- */
  var DEFS = {
    envoy_compact: {
      name: 'Compact Treaty Envoy', title: '📜 Compact Treaty Envoy', portrait: 'envoy_compact',
      text: function () {
        return '“The Compact keeps the lanes, captain. Our terms are written down — ' +
          'and we honor what is written.”\n\nSolar Compact standing: ' +
          factionStanding('compact') +
          '\n\n“An audience is a formality away. Shall I arrange one?”';
      },
      choices: function () {
        return [{
          label: 'Request an audience with the Compact', run: function () {
            try {
              if (SF.Factions && SF.Factions.negotiate) { SF.Factions.negotiate('compact'); return; }
            } catch (e) {}
            closeDlg(); toast('The treaty office is closed — dock at a Compact HQ.');
          }
        }, { label: '“Another time.”', run: function () { closeDlg(); } }];
      }
    },
    envoy_drifters: {
      name: 'Drifter Treaty Envoy', title: '📜 Drifter Treaty Envoy', portrait: 'envoy_drifters',
      text: function () {
        return '“Law is what the Compact can enforce. Out here it’s favors, fuel, ' +
          'and who showed up last time.”\n\nFree Drifters standing: ' +
          factionStanding('drifters') +
          '\n\n“Buy a round, remember a name, and the Drift remembers you.”';
      },
      choices: function () {
        return [{
          label: 'Request an audience with the Drifters', run: function () {
            try {
              if (SF.Factions && SF.Factions.negotiate) { SF.Factions.negotiate('drifters'); return; }
            } catch (e) {}
            closeDlg(); toast('The treaty office is closed — dock at a Drifter HQ.');
          }
        }, { label: '“Another time.”', run: function () { closeDlg(); } }];
      }
    },
    envoy_pact: {
      name: 'Pact Treaty Envoy', title: '📜 Pact Treaty Envoy', portrait: 'envoy_pact',
      text: function () {
        return '“The Pact does not negotiate from weakness. You are not weak, ' +
          'captain — that is why I am talking to you instead of at you.”\n\n' +
          'Ember Pact standing: ' + factionStanding('ember') +
          '\n\n“Name your terms. I will name their price.”';
      },
      choices: function () {
        return [{
          label: 'Request an audience with the Ember Pact', run: function () {
            try {
              if (SF.Factions && SF.Factions.negotiate) { SF.Factions.negotiate('ember'); return; }
            } catch (e) {}
            closeDlg(); toast('The treaty office is closed — dock at an Ember HQ.');
          }
        }, { label: '“Another time.”', run: function () { closeDlg(); } }];
      }
    },
    informant: {
      name: 'Black-Market Informant', title: '🕵 Black-Market Informant', portrait: 'informant',
      text: function () {
        return '“You want the corridor gossip or the profitable kind? The first is ' +
          'free. The second costs.”\n\n“I hear derelicts, patrol routes, ' +
          'which inspector takes bribes. Everything for sale, nothing ' +
          'on the record.”';
      },
      choices: function () {
        var self = talk;
        return [{
          label: 'Buy a tip (50cr)', run: function () {
            if (cr() < 50) { toast('Not enough credits.'); return; }
            try { SF.Player.credits -= 50; } catch (e) {}
            var TIPS = [
              'Derelict traffic is up past Ember Row — captains who check the far belt come back heavy.',
              'The customs inspector on Haven Dock takes bribes. Ask for “expedited clearance”.',
              'Ember patrols run hot near the rim after wars break out. Fly quiet or fly armed.',
              'Faction HQs post contracts every dock. The wire pays fastest for pirate kills.',
              'Someone’s been buying up salvage parts in bulk. Prices are climbing — sell now.'
            ];
            var tip = TIPS[Math.floor(Math.random() * TIPS.length)];
            SF.Dialogue.open({
              portrait: 'informant',
              title: '🕵 Black-Market Informant',
              text: '“' + tip + '”\n\n“Pleasure doing business. Forget my face.”',
              choices: []
            });
          }
        }, { label: '“Nothing today.”', run: function () { closeDlg(); } }];
      }
    },
    bookmaker: {
      name: 'Arena Bookmaker', title: '🎲 Arena Bookmaker', portrait: 'bookmaker',
      text: function () {
        return '“Odds, captain! I make the odds and the odds make me.”\n\n' +
          arenaLeagueLines() +
          '\n\n“Buy in at the COMBAT ARENA section. Winners pay in glory; ' +
          'losers pay in advance.”';
      },
      choices: function () {
        return [{ label: '“Set my odds.”', run: function () { closeDlg(); } }];
      }
    },
    ghost_captain: {
      name: 'Ghost Captain', title: '👻 Ghost Captain', portrait: 'ghost_captain',
      text: function () {
        return '“You see me, then. Most don’t, not until the hull is already ' +
          'cold.”\n\n“She sails on, captain — the Silent Choir keeps her ' +
          'broadcasts. Board her if you dare. Nothing dead keeps its ' +
          'lights on for nothing.”';
      },
      choices: function () {
        return [{ label: '“Rest easy, captain.”', run: function () { closeDlg(); } }];
      }
    },
    drone_tech: {
      name: 'Drone Bay Technician', title: '🛰 Drone Bay Technician', portrait: 'drone_tech',
      text: function () {
        return '“She’s a good little scavenger. Keep her plating greased and ' +
          'her optics clear and she’ll strip a wreck clean.”\n\n' +
          'Drones in your bay: ' + droneOwned() +
          '\n\n“Upgrades go on at the drone bench — one-time installs, ' +
          'she keeps them between runs.”';
      },
      choices: function () {
        return [{ label: '“Keep her flying.”', run: function () { closeDlg(); } }];
      }
    },
    salvage_broker: {
      name: 'Salvage Broker', title: '⚙ Salvage Broker', portrait: 'salvage_broker',
      text: function () {
        return '“Parts is parts, captain — but some parts is MONEY.”\n\n' +
          'Salvage in your hold: ' + salvageCount() + ' parts' +
          '\n\n“I buy clean, I sell cleaner. The crafting bench over there ' +
          'turns my leftovers into your drone’s next upgrade.”';
      },
      choices: function () {
        return [{ label: '“We’ll deal.”', run: function () { closeDlg(); } }];
      }
    }
  };

  function talk(id) {
    var def = DEFS[id];
    if (!def) return false;
    if (!window.SF || !SF.Dialogue || !SF.Dialogue.open) return false;
    try {
      SF.Dialogue.open({
        portrait: def.portrait,
        title: def.title,
        text: def.text(),
        choices: def.choices()
      });
      return true;
    } catch (e) { return false; }
  }

  SF.NPCPack3 = {
    defs: DEFS,
    talk: talk,
    ids: function () { return PACK3_IDS.slice(); }
  };

  /* ---- title -> pack-3 portrait resolution.
   * Anchors verified against the live tree (factions.js negotiate /
   * negotiateTalks / defection titles; secrets.js Silent Choir).
   * Checked BEFORE the pack-1/2 tables so the specific envoy wins
   * over the pack-2 '📜 treaty talks' -> warlord anchor. */
  var TITLE3 = [
    ['📜 treaty talks — solar compact', 'envoy_compact'],
    ['📜 treaty talks — free drifters', 'envoy_drifters'],
    ['📜 treaty talks — ember pact', 'envoy_pact'],
    ['🕊️ ceasefire talks — solar compact', 'envoy_compact'],
    ['🕊️ ceasefire talks — free drifters', 'envoy_drifters'],
    ['🕊️ ceasefire talks — ember pact', 'envoy_pact'],
    ['🕊️ ceasefire signed — solar compact', 'envoy_compact'],
    ['🕊️ ceasefire signed — free drifters', 'envoy_drifters'],
    ['🕊️ ceasefire signed — ember pact', 'envoy_pact'],
    ['🕊️ talks collapse — solar compact', 'envoy_compact'],
    ['🕊️ talks collapse — free drifters', 'envoy_drifters'],
    ['🕊️ talks collapse — ember pact', 'envoy_pact'],
    ['🤝 solar compact envoy', 'envoy_compact'],
    ['🤝 free drifters envoy', 'envoy_drifters'],
    ['🤝 ember pact envoy', 'envoy_pact'],
    ['🚨 a rival envoy approaches', 'envoy_compact']
  ];
  function resolvePack3(spec) {
    if (spec && spec.portrait && PACK3_IDS.indexOf(spec.portrait) >= 0) {
      return spec.portrait;
    }
    var t = String((spec && spec.title) || '').toLowerCase();
    var i;
    for (i = 0; i < TITLE3.length; i++) {
      if (t.indexOf(TITLE3[i][0]) === 0) return TITLE3[i][1];
    }
    if (t.indexOf('silent choir') >= 0) return 'ghost_captain';
    return null;
  }

  /* Same 112px dlg-portrait styling as the pack-1 portraitImg, kept
   * local (the original lives in an earlier IIFE's closure). */
  function insertPack3Portrait(body, pid) {
    try {
      if (!window.SF || !SF.Sprites || !SF.Sprites.get) return false;
      var img = SF.Sprites.get('portraits', pid);
      if (!img) return false; /* loader miss: caller keeps text-only fallback */
      var el = img.cloneNode(false);
      el.className = 'dlg-portrait';
      el.style.cssText = 'width:112px;height:112px;border-radius:10px;object-fit:cover;' +
        'border:2px solid rgba(127,212,255,.45);background:rgba(4,8,18,.6);flex:0 0 auto;';
      el.alt = 'portrait:' + pid;
      var h2 = body.querySelector('h2');
      if (!h2) return false;
      var wrap = document.createElement('div');
      wrap.className = 'dlg-speaker';
      wrap.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:10px;';
      h2.parentNode.insertBefore(wrap, h2);
      wrap.appendChild(el);
      wrap.appendChild(h2);
      return true;
    } catch (e) { return false; }
  }

  /* ---- SF.Portraits.insertIntoDialog wrap (__pw3i): pack-3 first ---- */
  (function () {
    if (!window.SF || !SF.Portraits || SF.Portraits.insertIntoDialog.__pw3i) return;
    var orig = SF.Portraits.insertIntoDialog;
    var w = function (body, spec) {
      var pid = null;
      try { pid = resolvePack3(spec); } catch (e) { /* fall through */ }
      if (pid) {
        try {
          if (body && !body.querySelector('.dlg-portrait') &&
              insertPack3Portrait(body, pid)) return true;
        } catch (e) { /* fall through to original */ }
      }
      return orig.call(this, body, spec);
    };
    w.__pw3i = true;
    SF.Portraits.insertIntoDialog = w;
  })();

  /* ---- Dialogue.open wrap (__pw3, outermost): resolve the pack-3
   * portrait from the spec BEFORE the inner __pw/__pw2 wraps run,
   * so spec.portrait survives into their insertion path. */
  (function installOpenWrap3() {
    if (!window.SF || !SF.Dialogue || !SF.Dialogue.open || SF.Dialogue.open.__pw3) return;
    var origOpen = SF.Dialogue.open; /* __pw2 wrap (outermost at install time) */
    var w3 = function (spec) {
      try {
        spec = spec || {};
        if (!spec.portrait) {
          var pid = resolvePack3(spec);
          if (pid) spec.portrait = pid;
        }
      } catch (e) { /* portrait must never break a dialogue */ }
      var r = origOpen.call(this, spec);
      /* Belt-and-suspenders: if the inner wraps never inserted our
       * portrait (e.g. the file 404'd there), try once more here. */
      try {
        var want = resolvePack3(spec);
        var body = document.getElementById('dialogue-body');
        if (want && body && !body.querySelector('.dlg-portrait')) {
          insertPack3Portrait(body, want);
        }
      } catch (e) { /* never break the dialogue */ }
      return r;
    };
    w3.__pw3 = true;
    SF.Dialogue.open = w3;
  })();

  /* ---- store-section TALK rows. Deferred install: blackmarket.js,
   * station.js (SF.Arena), crafting.js load AFTER npcs.js. Each row
   * gets a unique id and a unique wrap flag so re-runs stay clean. ---- */
  function addTalkRow3(body, rowId, name, desc, npcId) {
    if (!body || !body.querySelector) return;
    if (body.querySelector('#' + rowId)) return; // already added
    var div = document.createElement('div');
    div.className = 'store-row';
    div.id = rowId;
    div.innerHTML = '<div class="store-info"><div><div class="store-name">' + name +
      '</div><div class="store-desc">' + desc + '</div></div></div>';
    var btn = document.createElement('button');
    btn.className = 'btn store-btn';
    btn.textContent = 'TALK';
    btn.addEventListener('click', function () { talk(npcId); });
    div.appendChild(btn);
    body.appendChild(div);
  }

  (function installSectionWraps3(tries) {
    tries = tries || 0;
    var pending = false;

    /* informant: black-market panel (pack-2's __pw2b wrap stays chained). */
    if (window.SF && SF.BlackMarket && SF.BlackMarket.open && !SF.BlackMarket.open.__pw3a) {
      var origBM = SF.BlackMarket.open;
      var wb = function (site) {
        var r = origBM.apply(this, arguments);
        try {
          var body = document.getElementById('blackmarket-body');
          addTalkRow3(body, 'pw3-informant-row', '🕵 BLACK-MARKET INFORMANT',
            'Sells rumors and profitable tips. Cash only.', 'informant');
        } catch (e) { /* never break the market */ }
        return r;
      };
      wb.__pw3a = true;
      SF.BlackMarket.open = wb;
    } else if (!(window.SF && SF.BlackMarket && SF.BlackMarket.open)) { pending = true; }

    /* bookmaker: arena store section (pack-2's __pw2a wrap stays chained). */
    if (window.SF && SF.Arena && SF.Arena.renderSection && !SF.Arena.renderSection.__pw3b) {
      var origArena = SF.Arena.renderSection;
      var wa = function (body, curSt) {
        var r = origArena.apply(this, arguments);
        try {
          addTalkRow3(body, 'pw3-bookmaker-row', '🎲 ARENA BOOKMAKER',
            'Sets the odds on every league bout.', 'bookmaker');
        } catch (e) { /* never break the store */ }
        return r;
      };
      wa.__pw3b = true;
      SF.Arena.renderSection = wa;
    } else if (!(window.SF && SF.Arena && SF.Arena.renderSection)) { pending = true; }

    /* drone_tech + salvage_broker: crafting workbench section. */
    if (window.SF && SF.Crafting && SF.Crafting.renderWorkbench &&
        !SF.Crafting.renderWorkbench.__pw3c) {
      var origWB = SF.Crafting.renderWorkbench;
      var ww = function (body) {
        var r = origWB.apply(this, arguments);
        try {
          if (droneOwned() > 0) {
            addTalkRow3(body, 'pw3-dronetech-row', '🛰 DRONE BAY TECHNICIAN',
              'Keeps your salvage drone flying and upgraded.', 'drone_tech');
          }
          addTalkRow3(body, 'pw3-salvagebroker-row', '⚙ SALVAGE BROKER',
            'Buys clean, sells cleaner. Talks salvage.', 'salvage_broker');
        } catch (e) { /* never break the workbench */ }
        return r;
      };
      ww.__pw3c = true;
      SF.Crafting.renderWorkbench = ww;
    } else if (!(window.SF && SF.Crafting && SF.Crafting.renderWorkbench)) { pending = true; }

    if (pending && tries < 240) setTimeout(function () { installSectionWraps3(tries + 1); }, 500);
  })();
})();

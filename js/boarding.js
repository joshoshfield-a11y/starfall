/* STARFALL Phase 3 — boarding.js
 * Ship boarding: when a crewed enemy drops below 20% hull, BOARD it.
 * Assault screen runs crew-vs-crew auto-battle in rounds; both crews' numbers
 * tick down live. Win -> capture the ship (+ loot). Lose -> boarders dead.
 * Retreat keeps surviving boarders. Adrift enemies are captured unopposed.
 */
window.SF = window.SF || {};

SF.Boarding = (function () {
  var target = null;
  var attackers = [];   // refs into the active ship's crew (dead ones are removed)
  var defenders = 0;    // enemy crew count
  var defStars = 1;
  var timer = null;
  var round = 0;
  var done = false;
  var lastResult = '';
  // gameplay-depth: boarding v2 options — 'options' phase shows the approach
  // picker before any assault begins; 'assault' is the existing crew battle.
  var phase = 'assault';
  var optMsg = '';

  /* capital-ship-boarding: boss raid mode. Bosses spawn automated (unboardable)
   * but a crippled capital ship (hull < 15%) can be BREACHED: 3 deck rooms of
   * crew-vs-crew fighting on a 60s scuttle timer. Runtime-only, save-neutral. */
  var raidMode = false;
  var raid = null; // {boss, rooms:[{name,defenders,defStars}], idx, scuttleLeft, scuttleInt}
  var partyDownUntil = 0; // boarding locked while Date.now() < this (scuttle blast)
  var RAID_HULL_FRAC = 0.15;
  var RAID_SCUTTLE_S = 60;
  var RAID_ROOMS = [
    { name: 'ENGINEERING', defenders: 4, defStars: 2 },
    { name: 'ARMORY',      defenders: 5, defStars: 2 },
    { name: 'BRIDGE',      defenders: 6, defStars: 3 }
  ];
  var RAID_MOD = { boss_solace: 'amplifier', boss_drift: 'overclock', boss_ember: 'fury' };

  var CLASS_MAP = { raider: 'frigate', gunship: 'destroyer' };

  function enemyPower() {
    return defenders * SF.CONFIG.crew.enemyCrewPower *
      (1 + SF.CONFIG.upgrades.starStep * (Math.max(1, defStars) - 1));
  }

  function isRaidableBoss(e) {
    return !!(e && e.boss && !e.raidDone && e.hp < e.maxHp * RAID_HULL_FRAC &&
      SF.Enemies.list.indexOf(e) >= 0);
  }

  /* Nearest boardable enemy: crewed, in range, and (crippled or adrift).
   * Capital-ship bosses are boardable only via breach when crippled (<15%). */
  function findTarget(p) {
    if (Date.now() < partyDownUntil) return null; // party recovering from blast
    var cfg = SF.CONFIG.crew;
    var best = null, bd = cfg.boardRange;
    var el = SF.Enemies.list;
    for (var i = 0; i < el.length; i++) {
      var e = el[i];
      var raidable = isRaidableBoss(e);
      if (e.automated && !raidable) continue;
      var dx = e.x - p.x, dy = e.y - p.y;
      var d = Math.hypot(dx, dy);
      if (d > cfg.boardRange) continue;
      if (!raidable && !e.adrift && e.hp >= e.maxHp * cfg.boardHullFrac) continue;
      if (!best || d < bd) { best = e; bd = d; }
    }
    return best;
  }

  /* ---------- gameplay-depth: boarding v2 options screen ---------- */

  function empCapable() {
    var owned = SF.Player.weaponsOwned || [];
    for (var i = 0; i < owned.length; i++) {
      var wid = owned[i].id || owned[i];
      // boarding-voice-barks-wiring: weapon kind lives on SF.CONFIG.weapons,
      // NOT on the SF.WEAPONS store entry (SF.WEAPON_BY_ID[wid].kind is
      // undefined) — as written this always returned false, so the EMP-BREACH
      // button was permanently disabled and board_emp_01 could never fire.
      var wcfg = (SF.CONFIG && SF.CONFIG.weapons && SF.CONFIG.weapons[wid]) || null;
      var kind = wcfg ? wcfg.kind : ((SF.WEAPON_BY_ID[wid] || {}).kind);
      if (kind === 'emp') return true;
    }
    return false;
  }

  function renderOptions() {
    var body = document.getElementById('boarding-body');
    var raidHead = (raidMode && raid)
      ? '💥 BREACH — ' + raid.rooms[raid.idx].name +
        ' <span id="raid-timer">' + fmtScuttle(raid.scuttleLeft) + '</span>'
      : null;
    var html = '<div class="board-top dim">' + (raidHead ||
      (target ? target.spec.scoreName : '') +
      (target && target.bountyName ? ' · ☠ ' + target.bountyName : '') + ' · CHOOSE APPROACH') + '</div>';
    html += '<div class="board-cols"><div class="board-side"><h3>TARGET STATUS</h3>' +
      '<div class="board-list"><div class="board-member">Hull <b>' +
      Math.max(0, Math.round(target.hp)) + '/' + Math.round(target.maxHp) + '</b></div>' +
      '<div class="board-member">Enemy crew <b>' + defenders + '</b> ' +
      '<span style="color:#ffd23f">' + SF.Upgrade.starsText(defStars) + '</span></div>' +
      '<div class="board-member">Your boarders <b>' + SF.Player.crewCount() + '</b></div>' +
      (optMsg ? '<div class="board-member" style="color:#ff9d5e">' + optMsg + '</div>' : '') +
      '</div></div></div>';
    html += '<div class="board-cols" style="flex-direction:column;gap:6px;margin-top:8px">';
    html += '<button id="bo-assault" class="btn big ui-block">⚔ ASSAULT — crew-vs-crew</button>';
    html += '<button id="bo-surrender" class="btn big ui-block">🏳 DEMAND SURRENDER — intimidate them into cutting drives</button>';
    html += '<button id="bo-emp" class="btn big ui-block"' + (empCapable() ? '' : ' disabled') +
      '>⚡ EMP-BREACH — stun half their crew (needs EMP weapon · 100c charges)</button>';
    if (!raidMode) { // capital-ship-boarding: no parley mid-raid
      html += '<button id="bo-negotiate" class="btn big ui-block">🤝 NEGOTIATE — let them go for a ransom (needs good karma or friendly standing)</button>';
    }
    html += '</div>';
    body.innerHTML = html;
    function wire(id, fn) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { SF.Audio.ui(); fn(); });
    }
    wire('bo-assault', assault);
    wire('bo-surrender', demandSurrender);
    wire('bo-emp', empBreach);
    if (!raidMode) wire('bo-negotiate', negotiate);
  }

  function surrenderChance() {
    var c = 0.25;
    if (window.SF && SF.Factions) {
      var k = SF.Factions.karma();
      if (k >= 15) c += 0.25;            // heroes get respect
      else if (k <= -15) c += 0.15;      // monsters get fear
      if (target.faction && SF.Factions.stance(target.faction) === 'friendly') c += 0.30;
    }
    return Math.min(0.9, c);
  }

  function demandSurrender() {
    var roll = Math.random();
    if (roll < surrenderChance()) {
      optMsg = '';
      win(true, 'They cut their drives rather than face your crew. Ship captured!');
    } else {
      optMsg = '“You want the ship? Come take it.” — they open fire from the corridors.';
      assault();
    }
  }

  function empBreach() {
    if (!empCapable()) { SF.Audio.deny(); return; }
    if (SF.Player.credits < 100) {
      optMsg = 'Not enough credits for breach charges (100c).';
      renderOptions(); return;
    }
    SF.Player.credits -= 100;
    defenders = Math.ceil(defenders / 2);
    defStars = Math.max(1, defStars - 1);
    SF.HUD.toast('⚡ EMP-breach! Half their crew is stunned.');
    SF.Particles.burst(target.x, target.y, '#d28aff', 18, 220, 0.6, 3);
    SF.Audio.emp();
    playBark('board_emp_01'); // boarding-voice-barks-wiring: EMP-breach bark
    assault();
  }

  function negotiate() {
    if (raidMode) { // no parley in a boarding raid
      optMsg = '\u201cNo parley in a boarding raid.\u201d';
      renderOptions(); return;
    }
    var ok = false, why = '';
    if (window.SF && SF.Factions) {
      if (SF.Factions.karma() >= 15) { ok = true; why = 'your reputation precedes you'; }
      else if (target.faction && SF.Factions.stance(target.faction) === 'friendly') {
        ok = true; why = SF.FACTION_BY_ID[target.faction].name + ' respects you';
      }
    }
    if (ok) {
      var ransom = Math.round((target.spec.creditsMin + target.spec.creditsMax) / 2);
      SF.Player.credits += ransom;
      if (window.SF && SF.Factions) SF.Factions.shiftKarma(2);
      target.state = 'flee';
      target.hp = Math.max(target.hp, target.maxHp * 0.5); // no longer crippled
      playBark('board_ransom_01'); // boarding-voice-barks-wiring: ransom bark
      close();
      SF.HUD.toast('🤝 They pay ' + ransom + 'c for safe passage (' + why + '). Karma +2.');
      SF.Save.save();
    } else {
      optMsg = '“We don\'t parley with the likes of you.”';
      assault();
    }
  }

  function assault() {
    phase = 'assault';
    render();
    SF.Audio.ui();
    if (defenders <= 0) {
      timer = setInterval(function () { render(); win(true); },
        SF.CONFIG.crew.roundTime * 1000);
    } else {
      timer = setInterval(tick, SF.CONFIG.crew.roundTime * 1000);
    }
  }

  function crewRow(m) {
    return '<div class="board-member"><span class="tier-dot" style="background:' +
      SF.Crew.roleColor(m.role) + '"></span>' +
      '<span>' + m.name + '</span> <span class="dim">' + SF.Crew.roleName(m.role) +
      '</span> <span style="color:#ffd23f">' + SF.Upgrade.starsText(m.stars) + '</span></div>';
  }

  function render() {
    var body = document.getElementById('boarding-body');
    var A = SF.Crew.totalPower(attackers);
    var D = enemyPower();
    var raidHead = (raidMode && raid)
      ? '💥 ' + raid.rooms[raid.idx].name +
        ' <span id="raid-timer">' + fmtScuttle(raid.scuttleLeft) + '</span>'
      : (target ? target.spec.scoreName : '');
    var html = '<div class="board-top dim">' + raidHead +
      ' · ROUND ' + round + (lastResult ? ' · ' + lastResult : '') + '</div>';
    html += '<div class="board-cols">';
    html += '<div class="board-side"><h3>YOUR PARTY (' + attackers.length + ')</h3>' +
      '<div class="board-power">power ' + Math.round(A) + '</div><div class="board-list">';
    for (var i = 0; i < attackers.length; i++) html += crewRow(attackers[i]);
    if (!attackers.length) html += '<div class="dim">— wiped out —</div>';
    html += '</div></div>';
    html += '<div class="board-vs">⚔</div>';
    html += '<div class="board-side"><h3>ENEMY CREW (' + defenders + ')</h3>' +
      '<div class="board-power">power ' + Math.round(D) + '</div>' +
      '<div class="board-list"><div class="board-member"><span class="dim">Hostile crew</span> ' +
      '<span style="color:#ffd23f">' + SF.Upgrade.starsText(defStars) + '</span></div>' +
      '<div class="dim" style="margin-top:6px">fights as a pack</div></div></div>';
    html += '</div>';
    if (!done) {
      html += '<button id="btn-retreat" class="btn big ui-block">🏳 RETREAT (' +
        attackers.length + ' survive)</button>';
    } else {
      html += '<div class="dim">resolving…</div>';
    }
    body.innerHTML = html;
    var rb = document.getElementById('btn-retreat');
    if (rb) rb.addEventListener('click', function () { SF.Audio.ui(); retreat(); });
  }

  function tick() {
    if (done) return;
    round++;
    var A = SF.Crew.totalPower(attackers);
    var D = enemyPower();
    var K = SF.CONFIG.crew.roundCasualties;
    var atkLoss = Math.round(D / (A + D + 0.001) * K * (0.7 + 0.6 * Math.random()));
    var defLoss = Math.round(A / (A + D + 0.001) * K * (0.7 + 0.6 * Math.random()));
    atkLoss = Math.max(0, Math.min(atkLoss, attackers.length));
    defLoss = Math.max(0, Math.min(defLoss, defenders));

    var shipCrew = SF.Player.crewList();
    for (var i = 0; i < atkLoss; i++) {
      var dead = attackers.splice(Math.floor(Math.random() * attackers.length), 1)[0];
      var si = shipCrew.indexOf(dead);
      if (si >= 0) shipCrew.splice(si, 1);
    }
    defenders -= defLoss;
    lastResult = 'you lost ' + atkLoss + ', they lost ' + defLoss;
    SF.Audio.hit();
    if (defenders <= 0) { render(); win(false); return; }
    if (attackers.length === 0) { render(); lose(); return; }
    render();
  }

  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    // capital-ship-boarding: defensive — legit raid exits already cleaned up
    if (raidMode) { stopScuttle(); raidMode = false; raid = null; }
    target = null;
    SF.Game.setState('PLAYING');
  }

  function win(unopposed, msg) {
    if (done) return;
    if (raidMode) { done = true; roomWon(msg); return; } // capital-ship-boarding
    done = true;
    var e = target;
    var idx = SF.Enemies.list.indexOf(e);
    if (idx >= 0) SF.Enemies.list.splice(idx, 1);
    var cls = CLASS_MAP[e.type] || 'frigate';
    var prize = {
      name: 'Prize \u2018' + (e.spec.scoreName || e.type) + '\u2019',
      classId: cls, parts: [], crew: [], hadCrew: false
    };
    SF.Player.ships.push(prize);
    var loot = Math.round((e.spec.creditsMin + e.spec.creditsMax) / 2 *
      SF.CONFIG.crew.captureBonusMul);
    SF.Player.credits += loot;
    SF.Particles.burst(e.x, e.y, '#ffd23f', 30, 260, 0.8, 4);
    SF.Audio.explosion(false);
    close();
    SF.HUD.toast(msg || (unopposed
      ? 'Ship captured unopposed! +' + loot + 'c — ' + prize.name + ' added'
      : 'Ship captured! +' + loot + 'c — ' + prize.name + ' added (rebuild it in the Ship Builder)'));
    SF.Save.save();
  }

  function lose() {
    if (done) return;
    if (raidMode) { done = true; raidLost(); return; } // capital-ship-boarding
    done = true;
    if (target) target.state = 'flee'; // crippled, limps away
    close();
    SF.HUD.toast('Boarding repulsed — your party is gone.');
    SF.Audio.gameOver();
    SF.Save.save();
  }

  function retreat() {
    if (done) return;
    if (raidMode) { done = true; abortRaid(); return; } // capital-ship-boarding
    done = true;
    close();
    SF.HUD.toast('Boarding party recalled (' + attackers.length + ' survived).');
    SF.Save.save();
  }

  /* ================= capital-ship-boarding: boss raid mode ================= */

  function bossTitle(b) {
    return (b.bossDef && (b.bossDef.title || b.bossDef.name)) || 'Capital Ship';
  }

  function fmtScuttle(s) {
    s = Math.max(0, s);
    return '⚠ SCUTTLE ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function stopScuttle() {
    if (raid && raid.scuttleInt) { clearInterval(raid.scuttleInt); raid.scuttleInt = null; }
  }

  /* boarding-sfx-wiring: guarded raid SFX. SF.Audio.sfx() routes through the
   * ogg buffer cache with a procedural synth fallback, so a missing ogg can
   * never break the game — but Audio itself may be absent in some contexts,
   * hence the existence check. No-op silently if unavailable. */
  function raidSfx(id) {
    try {
      if (window.SF && SF.Audio && typeof SF.Audio.sfx === 'function') SF.Audio.sfx(id);
    } catch (e) { /* never break the raid on a sound */ }
  }


  /* ============================================================
   * boarding-voice-barks-wiring
   *
   * Wires the boarding-raid voice barks (ids from voice-pack-7 +
   * voice-pack-4; assets already in the live tree) via guarded
   * SF.Audio.voice calls + subtitle captions on the shared
   * #sf-voice-caption element (campaign.js voice-barks pattern).
   * A new bark interrupts the previous caption. Save-neutral:
   * no persisted state, no version bump. Line text + durations are
   * the real ones from phases/voice-pack-7/gen/lines.csv and
   * ffprobe of the shipped oggs.
   * ============================================================ */
  var VOICE_BARKS = {
    board_emp_01:      { n: 'TACTICAL',    c: '#d28aff',
      t: 'E M P breach! Their crew is stunned. Move in, boarding team.', d: 4.18 },
    board_ransom_01:   { n: 'TACTICAL',    c: '#d28aff',
      t: 'They are paying for safe passage, captain. Credits are credits.', d: 4.14 },
    war_officer_board: { n: 'WAR OFFICER', c: '#7dff9a',
      t: 'War board updated. New contracts posted at Aegis Citadel, Karavan Prime, and the Ashen Throne. Choose your war.', d: 6.16 }
  };
  var barkTimer = null;

  /* Reuse the shared caption element campaign.js created when the story
   * ran (ngplus-voice-wiring pattern); create it lazily if absent. */
  function ensureBarkCaption() {
    var el = document.getElementById('sf-voice-caption');
    if (el) return el;
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

  function hideBarkCaption() {
    var el = document.getElementById('sf-voice-caption');
    if (el) el.style.display = 'none';
  }

  function playBark(id) {
    var b = VOICE_BARKS[id];
    try {
      if (window.SF && SF.Audio && typeof SF.Audio.voice === 'function') SF.Audio.voice(id);
    } catch (e) { /* voice must never break boarding */ }
    if (!b) return;
    if (barkTimer) { clearTimeout(barkTimer); barkTimer = null; }
    try {
      var el = ensureBarkCaption();
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:' + b.c +
        ';margin-bottom:4px;font-weight:700;';
      sp.textContent = b.n;
      var tx = document.createElement('div');
      tx.textContent = b.t;
      el.appendChild(sp); el.appendChild(tx);
      el.style.display = 'block';
      barkTimer = setTimeout(function () {
        barkTimer = null; hideBarkCaption();
      }, Math.max(1500, b.d * 1000));
    } catch (e) { /* captions must never break boarding */ }
  }

  function startRaid(boss) {
    raidMode = true;
    raid = {
      boss: boss,
      rooms: RAID_ROOMS.map(function (r) {
        return { name: r.name, defenders: r.defenders, defStars: r.defStars };
      }),
      idx: 0, scuttleLeft: RAID_SCUTTLE_S, scuttleInt: null
    };
    target = boss;
    SF.Game.setState('BOARDING');
    renderRaidIntro();
    SF.Audio.ui();
  }

  function renderRaidIntro() {
    var boss = raid.boss;
    var body = document.getElementById('boarding-body');
    var html = '<div class="board-top dim">⚠ ' + bossTitle(boss).toUpperCase() +
      ' · HULL CRITICAL</div>';
    html += '<div class="board-list"><div class="board-member">Hull <b>' +
      Math.max(0, Math.round(boss.hp)) + '/' + Math.round(boss.maxHp) + '</b></div>';
    html += '<div class="board-member">Decks to clear: <b>' +
      raid.rooms.map(function (r) { return r.name; }).join(' → ') + '</b></div>';
    html += '<div class="board-member">Your boarders <b>' + SF.Player.crewCount() + '</b></div>';
    html += '<div class="board-member" style="color:#ff9d5e">⚠ Her reactor is going ' +
      'critical — 60s to take the bridge or she blows.</div></div>';
    html += '<div class="board-cols" style="flex-direction:column;gap:6px;margin-top:8px">';
    html += '<button id="bo-breach" class="btn big ui-block">💥 BREACH — storm the decks</button>';
    html += '<button id="bo-raid-no" class="btn big ui-block">WITHDRAW — let her burn</button></div>';
    body.innerHTML = html;
    function wire(id, fn) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { SF.Audio.ui(); fn(); });
    }
    wire('bo-breach', breach);
    wire('bo-raid-no', function () {
      raidMode = false; raid = null; close();
      SF.HUD.toast('You let the hulk burn.');
    });
  }

  function breach() {
    startScuttle();
    raidSfx('breach_alarm'); // boarding-sfx-wiring: raid start alarm
    playBark('war_officer_board'); // boarding-voice-barks-wiring: war-officer bark
    SF.HUD.toast('💥 Breaching party away — 60 seconds!');
    raidRoom();
  }

  function startScuttle() {
    stopScuttle();
    raid.scuttleLeft = RAID_SCUTTLE_S;
    raid.scuttleInt = setInterval(function () {
      if (!raid) { stopScuttle(); return; }
      raid.scuttleLeft--;
      // boarding-sfx-wiring: scuttle-timer milestones (30s / 10s)
      if (raid.scuttleLeft === 30 || raid.scuttleLeft === 10) raidSfx('scuttle_warn');
      var el = document.getElementById('raid-timer');
      if (el) el.textContent = fmtScuttle(raid.scuttleLeft);
      if (raid.scuttleLeft <= 0) scuttleBlow();
    }, 1000);
  }

  /* One deck room: same crew-vs-crew options screen as normal boarding. */
  function raidRoom() {
    if (timer) { clearInterval(timer); timer = null; } // no stale room ticking
    var room = raid.rooms[raid.idx];
    target = raid.boss;
    defenders = room.defenders;
    defStars = room.defStars;
    if (raid.idx === 0) attackers = SF.Player.crewList().slice();
    round = 0; done = false; lastResult = ''; optMsg = '';
    phase = 'options';
    renderOptions();
  }

  function roomWon(msg) {
    var room = raid.rooms[raid.idx];
    SF.HUD.toast('✓ ' + room.name + ' secured' + (msg ? ' — ' + msg : ''));
    SF.Audio.ui();
    if (raid.idx >= raid.rooms.length - 1) { raidWon(); return; }
    raid.idx++;
    raidRoom();
  }

  function raidWon() {
    var boss = raid.boss;
    stopScuttle();
    raidSfx('bridge_taken'); // boarding-sfx-wiring: bridge captured
    var idx = SF.Enemies.list.indexOf(boss);
    if (idx >= 0) SF.Enemies.list.splice(idx, 1);
    boss.raidDone = true;
    var modId = RAID_MOD[boss.bossId] || 'amplifier';
    if (window.SF && SF.Mods && SF.Mods.addMod) SF.Mods.addMod(modId);
    var modName = (window.SF && SF.MOD_BY_ID && SF.MOD_BY_ID[modId])
      ? SF.MOD_BY_ID[modId].name : modId;
    var dropItem = (boss.bossDef && boss.bossDef.dropItem) || 'gravcore';
    if (window.SF && SF.Player && SF.Player.addPart) SF.Player.addPart(dropItem, 2);
    var cr = boss.bossDef && boss.bossDef.creditReward;
    var loot = cr ? Math.round((cr[0] + cr[1]) / 2) : 1500;
    SF.Player.credits += loot;
    raidMode = false; raid = null;
    SF.Particles.burst(boss.x, boss.y, '#ffd23f', 40, 300, 1, 5);
    SF.Audio.ui();
    close();
    SF.HUD.toast('🏆 ' + bossTitle(boss) + ' taken! +' + modName +
      ' mod, 2× ' + dropItem + ', +' + loot + 'c');
    SF.Save.save();
  }

  function raidLost() {
    var boss = raid.boss;
    boss.raidDone = true; // this hulk won't offer breach again
    stopScuttle();
    raidMode = false; raid = null;
    // attackers were already removed from the ship's crew by tick()
    close();
    SF.HUD.toast('☠ Boarding party wiped out aboard the ' + bossTitle(boss) + '.');
    SF.Audio.gameOver();
    SF.Save.save();
  }

  function abortRaid() {
    stopScuttle();
    raidMode = false; raid = null;
    close();
    SF.HUD.toast('Raid aborted — boarding party recalled.');
    SF.Save.save();
  }

  function scuttleBlow() {
    if (!raid) return;
    var boss = raid.boss;
    stopScuttle();
    var idx = SF.Enemies.list.indexOf(boss);
    if (idx >= 0) SF.Enemies.list.splice(idx, 1);
    raidMode = false; raid = null;
    partyDownUntil = Date.now() + 5 * 60 * 1000; // party lost for 5 min (runtime)
    SF.Particles.burst(boss.x, boss.y, '#ff5e3a', 60, 420, 1.2, 6);
    SF.Audio.explosion(true);
    close();
    SF.HUD.toast('💥 The ' + bossTitle(boss) +
      ' detonates! Your boarding party is lost in the blast — recovering for 5:00.');
    SF.Save.save();
  }

  return {
    findTarget: findTarget,

    open: function (e) {
      // capital-ship-boarding: party recovering from a scuttle blast
      if (Date.now() < partyDownUntil) {
        var s = Math.ceil((partyDownUntil - Date.now()) / 1000);
        SF.HUD.toast('Boarding party recovering from the blast — ' + s + 's');
        SF.Audio.deny(); return;
      }
      if (!e || (e.automated && !isRaidableBoss(e))) { SF.HUD.toast('Automated — nothing to board'); return; }
      // gameplay-depth: distress-beacon pirate trap springs on boarding
      if (e.distressTrap) {
        var mul = SF.SYSTEM_BY_ID[SF.Game.systemId] ? SF.SYSTEM_BY_ID[SF.Game.systemId].enemyMul : 1;
        for (var t = 0; t < 3; t++) {
          var a = Math.random() * Math.PI * 2;
          SF.Enemies.spawn('raider', e.x + Math.cos(a) * 500, e.y + Math.sin(a) * 500,
            mul, { encounter: 'ambush' });
        }
        e.distressTrap = false;
        e.adrift = false;
        e.hp = e.maxHp; e.crew = Math.max(e.crew, 2);
        SF.HUD.toast('⚠ It was a trap! Hostiles decloaking!');
        SF.Audio.deny();
        SF.Save.save();
        return;
      }
      if (SF.Player.crewCount() === 0 && !e.adrift) {
        SF.HUD.toast('No crew to send! Hire at Haven Dock.');
        SF.Audio.deny();
        return;
      }
      if (isRaidableBoss(e)) { startRaid(e); return; } // capital-ship-boarding
      target = e;
      attackers = SF.Player.crewList().slice();
      defenders = e.adrift ? 0 : e.crew;
      defStars = e.crewStars || 1;
      round = 0; done = false; lastResult = ''; optMsg = '';
      phase = 'options'; // gameplay-depth: approach picker first
      SF.Game.setState('BOARDING');
      renderOptions();
      SF.Audio.ui();
    },

    // test hook: resolve one round synchronously, returns {atkLoss, defLoss, over}
    testTick: function () {
      if (done || !target) return null;
      var before = { atk: attackers.length, def: defenders };
      tick();
      return { atkLoss: before.atk - attackers.length, defLoss: before.def - defenders,
               over: done, attackers: attackers.length, defenders: defenders };
    },
    testState: function () {
      return { attackers: attackers.length, defenders: defenders, round: round, done: done };
    },
    // capital-ship-boarding: test hooks
    raidable: isRaidableBoss,
    testRaidState: function () {
      return { raidMode: raidMode, idx: raid ? raid.idx : -1,
        rooms: raid ? raid.rooms.length : 0,
        scuttleLeft: raid ? raid.scuttleLeft : -1,
        done: done, partyDown: Date.now() < partyDownUntil };
    },
    testScuttle: function () { if (raid) scuttleBlow(); },
    testSetRoomDefenders: function (n) { defenders = n; },
    // boarding-sfx-wiring: test hook for the guarded SFX call
    testRaidSfx: raidSfx,
    // boarding-voice-barks-wiring: test hooks for guarded voice playback
    testPlayBark: playBark,
    testVoiceBarks: function () { return VOICE_BARKS; }
  };
})();

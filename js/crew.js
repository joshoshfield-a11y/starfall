/* STARFALL Phase 3 — crew.js
 * Crew members: generated names, tier 1-5 stars, role (marine/gunner/engineer).
 * Boarding power = roleBase * starMult, marines count double in assaults.
 * A crew member is { name, role, stars }. Rosters live on ship objects.
 *
 * --- crew-depth phase (2026-10-20): morale, leveling, shipboard perks ---
 * Additive keys on the existing records — no save-schema change, no refactor:
 *   morale (0-100, default 60): drifts with mission outcomes (victory +, defeat -,
 *     crewmate death -, idle dry spells decay), shown with mood states.
 *   xp (default 0) / level (1-3, default 1): XP from kills + contracts,
 *     rank titles Recruit -> Veteran -> Ace. Records live on ship objects which
 *     survive NG+ (acceptNGPlus keeps the roster), so levels never reset.
 *   perks: per-role passive, scaling with level and morale, recomputed from
 *     the live roster on every SF.Crew.perks(ship) call (rosters are small;
 *     no stale cache possible). recalcPerks(ship) also caches non-enumerably
 *     as ship._crewPerks for stat readers that want it.
 * Defensive reads everywhere: old save records without the new keys get
 * defaults materialized by ensure(). SAVE_VERSION is NOT bumped by this
 * file — a future js/save.js phase can formalize the version bump.
 * UI helpers live here too (scope js/crew.js only): mood(), statusLine(),
 * renderRowHTML() for the station UI, and showRosterPanel(), a floating
 * roster overlay the player can open any time.
 */
window.SF = window.SF || {};

SF.Crew = (function () {
  var FIRST = ['Vex', 'Mara', 'Juno', 'Kade', 'Rook', 'Sable', 'Taryn', 'Dax',
    'Nyx', 'Corv', 'Ilsa', 'Bram', 'Zia', 'Holt', 'Perrin', 'Saskia',
    'Renn', 'Odessa', 'Finn', 'Greta', 'Silas', 'Wren', 'Koda', 'Lux'];
  var LAST = ['Vane', 'Kessler', 'Dray', 'Morozov', 'Quill', 'Reyes', 'Tanaka',
    'Volkov', 'Ashford', 'Blackwood', 'Crane', 'Delacroix', 'Falk', 'Grimm',
    'Hale', 'Ivers', 'Jorunn', 'Kaine', 'Locke', 'Mercer', 'Nakamura',
    'Okafor', 'Pryce', 'Rook'];

  var ROLE_INFO = {
    marine:   { name: 'Marine',   color: '#ff5e3a', desc: 'Boarding assault specialist. Counts double in assaults.' },
    gunner:   { name: 'Gunner',   color: '#ffd23f', desc: 'Ship gunner. Solid in a boarding fight.' },
    engineer: { name: 'Engineer', color: '#3fa9ff', desc: 'Keeps the ship breathing. Fights when cornered.' }
  };

  function starMult(s) {
    return 1 + SF.CONFIG.upgrades.starStep * (Math.max(1, Math.min(5, s)) - 1);
  }

  function power(m) {
    var base = (SF.CONFIG.crew.roleBase[m.role] !== undefined)
      ? SF.CONFIG.crew.roleBase[m.role] : 5;
    var p = base * starMult(m.stars);
    if (m.role === 'marine') p *= SF.CONFIG.crew.marineBoardMul;
    return p;
  }

  function totalPower(list) {
    var t = 0;
    for (var i = 0; i < list.length; i++) t += power(list[i]);
    return t;
  }

  function hireCost(stars) {
    return Math.round(SF.CONFIG.crew.hireBase *
      Math.pow(SF.CONFIG.crew.hireGrowth, Math.max(1, Math.min(5, stars)) - 1));
  }

  function makeName() {
    return FIRST[Math.floor(Math.random() * FIRST.length)] + ' ' +
           LAST[Math.floor(Math.random() * LAST.length)];
  }

  function make(stars, role) {
    return { name: makeName(), role: role || 'marine', stars: stars || 1 };
  }

  /* Weighted random: returns 1-5. */
  function rollStars() {
    var r = Math.random();
    if (r < 0.45) return 1;
    if (r < 0.75) return 2;
    if (r < 0.90) return 3;
    if (r < 0.97) return 4;
    return 5;
  }

  function rollRole() {
    var r = Math.random();
    if (r < 0.40) return 'marine';
    if (r < 0.75) return 'gunner';
    return 'engineer';
  }

  function rollRoster(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(make(rollStars(), rollRole()));
    // show the best candidates first
    out.sort(function (a, b) { return power(b) - power(a); });
    return out;
  }

  /* Remove n members from list (in place). marinesLast: non-marines die first.
   * Returns the removed members. */
  function killMembers(list, n, marinesLast) {
    var dead = [];
    while (n > 0 && list.length > 0) {
      var idx = -1;
      if (marinesLast) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].role !== 'marine') { idx = i; break; }
        }
      }
      if (idx < 0) idx = Math.floor(Math.random() * list.length);
      dead.push(list.splice(idx, 1)[0]);
      n--;
    }
    return dead;
  }

  function count(ship) { return ship && ship.crew ? ship.crew.length : 0; }

  function roleName(r) { return ROLE_INFO[r] ? ROLE_INFO[r].name : r; }
  function roleColor(r) { return ROLE_INFO[r] ? ROLE_INFO[r].color : '#fff'; }

  /* ================= crew-depth: morale / leveling / perks ================= */

  var MORALE_DEFAULT = 60;
  var MORALE_WIN = 12;    // mission victory
  var MORALE_LOSS = -15;  // mission defeat / ship destroyed
  var MORALE_DEATH = -8;  // survivors' hit when a crewmate dies
  var MORALE_IDLE = -2;   // dry-spell decay per tickIdle call
  var MORALE_MIN = 5;     // decay never pushes below this

  var XP_PER_KILL = 8;     // xp per crew member per kill
  var XP_PER_CONTRACT = 60; // xp per crew member per completed contract
  var LVL2_XP = 120, LVL3_XP = 350;
  var RANK_TITLES = { 1: 'Recruit', 2: 'Veteran', 3: 'Ace' };

  // per-role, per-level perk rates (scaled by the member's morale factor)
  var PERK_CRIT_PER_LVL = 0.02;     // gunner: +crit chance fraction
  var PERK_COOLDOWN_PER_LVL = 0.06; // engineer: weapon cooldown multiplier step
  var PERK_REGEN_PER_LVL = 0.2;     // marine: +hull regen hp/s
  var COOLDOWN_FLOOR = 0.5;

  var MOODS = [
    { max: 19,  label: 'Broken',    color: '#ff4444' },
    { max: 39,  label: 'Shaken',    color: '#ff9a3c' },
    { max: 64,  label: 'Steady',    color: '#9fd0ff' },
    { max: 84,  label: 'Confident', color: '#7dff8a' },
    { max: 100, label: 'Inspired',  color: '#ffd23f' }
  ];

  /* Defensive read: fill missing additive keys on any crew record (mutates).
   * Old saves (plain {name, role, stars}) get defaults materialized here. */
  function ensure(m) {
    if (!m || typeof m !== 'object') return m;
    if (typeof m.morale !== 'number' || !isFinite(m.morale)) m.morale = MORALE_DEFAULT;
    m.morale = Math.max(0, Math.min(100, m.morale));
    if (typeof m.xp !== 'number' || !isFinite(m.xp) || m.xp < 0) m.xp = 0;
    m.level = (m.xp >= LVL3_XP) ? 3 : ((m.xp >= LVL2_XP) ? 2 : 1);
    return m;
  }

  function rosterOf(ship) {
    if (!ship) return [];
    if (Array.isArray(ship)) return ship;
    return ship.crew || [];
  }

  function moodOf(morale) {
    for (var i = 0; i < MOODS.length; i++) {
      if (morale <= MOODS[i].max) return MOODS[i];
    }
    return MOODS[MOODS.length - 1];
  }

  function mood(m) {
    ensure(m);
    return moodOf(m.morale);
  }

  function rankTitle(lvl) {
    return RANK_TITLES[Math.max(1, Math.min(3, lvl))] || 'Recruit';
  }

  function statusLine(m) {
    ensure(m);
    var md = moodOf(m.morale);
    var stars = '';
    for (var i = 0; i < Math.max(1, Math.min(5, m.stars)); i++) stars += '★';
    return md.label + ' · Lv' + m.level + ' ' + rankTitle(m.level) +
      ' · ' + roleName(m.role) + ' ' + stars;
  }

  /* Per-member perk effectiveness: 0.6 at 0 morale, 1.0 at 100. */
  function moraleFactor(m) {
    ensure(m);
    return 0.6 + 0.4 * (m.morale / 100);
  }

  /* Recompute shipboard perks from the LIVE roster (always fresh).
   * Returns { critBonus, cooldownMul, hullRegen, avgMorale, members,
   *           byMember: [{name, role, level, mood, desc}] }. */
  function perks(ship) {
    var list = rosterOf(ship);
    var out = { critBonus: 0, cooldownMul: 1, hullRegen: 0,
                avgMorale: MORALE_DEFAULT, members: 0, byMember: [] };
    if (!list.length) return out;
    var moraleSum = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      var eff = m.level * moraleFactor(m);
      var desc = '';
      if (m.role === 'gunner') {
        var c = PERK_CRIT_PER_LVL * eff;
        out.critBonus += c;
        desc = '+' + (c * 100).toFixed(1) + '% crit';
      } else if (m.role === 'engineer') {
        out.cooldownMul *= (1 - PERK_COOLDOWN_PER_LVL * eff);
        desc = '-' + (PERK_COOLDOWN_PER_LVL * eff * 100).toFixed(1) + '% cooldown';
      } else if (m.role === 'marine') {
        var r = PERK_REGEN_PER_LVL * eff;
        out.hullRegen += r;
        desc = '+' + r.toFixed(2) + ' hull/s regen';
      }
      moraleSum += m.morale; n++;
      out.byMember.push({ name: m.name, role: m.role, level: m.level,
                          mood: moodOf(m.morale).label, desc: desc });
    }
    out.cooldownMul = Math.max(COOLDOWN_FLOOR, out.cooldownMul);
    out.avgMorale = moraleSum / n;
    out.members = n;
    return out;
  }

  /* recalcPerks: same as perks(), plus caches non-enumerably on the ship
   * (non-enumerable => save.js JSON serialization ignores it). */
  function recalcPerks(ship) {
    var p = perks(ship);
    if (ship && typeof ship === 'object' && !Array.isArray(ship)) {
      try {
        Object.defineProperty(ship, '_crewPerks',
          { value: p, writable: true, enumerable: false, configurable: true });
      } catch (e) { ship._crewPerks = p; }
    }
    return p;
  }

  function perkSummary(ship) {
    var p = perks(ship);
    if (!p.members) return 'No crew — no shipboard perks.';
    var bits = [];
    if (p.critBonus > 0) bits.push('+' + (p.critBonus * 100).toFixed(1) + '% crit');
    if (p.cooldownMul < 1) bits.push((p.cooldownMul * 100).toFixed(0) + '% cooldown');
    if (p.hullRegen > 0) bits.push('+' + p.hullRegen.toFixed(1) + ' hull/s');
    return 'Crew perks (' + p.members + '): ' + bits.join(' · ') +
      ' — morale ' + Math.round(p.avgMorale) + '/100';
  }

  /* Grant xp to every crew member; returns promotions [{member, from, to}]. */
  function grantXP(ship, xp) {
    var list = rosterOf(ship);
    var promos = [];
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      var before = m.level;
      m.xp += Math.max(0, xp);
      ensure(m);
      if (m.level > before) promos.push({ member: m, from: before, to: m.level });
    }
    return promos;
  }

  function onKill(ship, n) {
    n = (typeof n === 'number' && n > 0) ? n : 1;
    grantXP(ship, XP_PER_KILL * n);
    var list = rosterOf(ship);
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      m.morale = Math.min(100, m.morale + 1); // small win bump per kill
    }
  }

  function onContract(ship, xp) {
    grantXP(ship, (typeof xp === 'number' && xp >= 0) ? xp : XP_PER_CONTRACT);
  }

  function bumpMorale(ship, delta) {
    var list = rosterOf(ship);
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      m.morale = Math.max(0, Math.min(100, m.morale + delta));
    }
  }

  /* Mission outcome hooks — wire from quests.js turnIn / ship death phases. */
  function onMissionWon(ship) { bumpMorale(ship, MORALE_WIN); }
  function onMissionLost(ship) { bumpMorale(ship, MORALE_LOSS); }

  /* Crewmate deaths (e.g. ship.js crew depletion): survivors lose morale. */
  function onMemberDeath(ship, dead) {
    bumpMorale(ship, MORALE_DEATH);
    return dead;
  }

  /* Dry-spell decay: call once per idle window (a future main.js phase can
   * drive this, e.g. once per in-game hour with no kills/contracts). */
  function tickIdle(ship) {
    var list = rosterOf(ship);
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      m.morale = Math.max(MORALE_MIN, m.morale + MORALE_IDLE);
    }
  }

  /* NG+ hook: the roster survives prestige (acceptNGPlus keeps crew), so
   * levels persist by construction. This boosts morale for the new cycle
   * and marks rank-3 members as cycle veterans. */
  function onPrestige(ship) {
    var list = rosterOf(ship);
    for (var i = 0; i < list.length; i++) {
      var m = ensure(list[i]);
      m.morale = Math.min(100, m.morale + 10);
      if (m.level >= 3) m.veteran = true;
    }
    return list.length;
  }

  /* ---------- UI (self-contained in crew.js) ---------- */

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Row HTML the station UI can drop into the crew hire panel. */
  function renderRowHTML(m) {
    ensure(m);
    var md = moodOf(m.morale);
    var stars = '';
    for (var i = 0; i < Math.max(1, Math.min(5, m.stars)); i++) stars += '★';
    var barW = Math.round(m.morale);
    return '<div class="crew-depth-row" style="padding:4px 0;border-bottom:1px solid #223">' +
      '<span class="tier-dot" style="background:' + roleColor(m.role) + '"></span> ' +
      '<b>' + escHtml(m.name) + '</b> ' +
      '<span class="dim">' + escHtml(roleName(m.role)) + ' ' + stars + ' · Lv' + m.level +
      ' ' + escHtml(rankTitle(m.level)) + '</span><br>' +
      '<span style="color:' + md.color + '">' + md.label + '</span> ' +
      '<span style="display:inline-block;width:90px;height:8px;background:#223;vertical-align:middle">' +
      '<span style="display:inline-block;width:' + barW + '%;height:8px;background:' + md.color + '"></span></span> ' +
      '<span class="dim">' + Math.round(m.morale) + '/100 · ' + m.xp + ' xp</span></div>';
  }

  var _panelShip = null;

  /* Floating roster overlay: morale bars, mood states, rank titles, perks. */
  function showRosterPanel(ship) {
    var el = document.getElementById('crew-depth-panel');
    if (el) { el.classList.toggle('hidden'); _panelShip = null; return null; }
    _panelShip = ship || null;
    el = document.createElement('div');
    el.id = 'crew-depth-panel';
    el.style.cssText = 'position:fixed;right:10px;bottom:70px;width:320px;max-height:60vh;' +
      'overflow-y:auto;background:rgba(8,12,24,.96);border:1px solid #3fa9ff;border-radius:8px;' +
      'padding:10px 12px;z-index:9000;font-family:inherit;color:#cfe3ff;font-size:13px';
    var list = rosterOf(_panelShip);
    var html = '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<b>👥 CREW — morale &amp; perks</b>' +
      '<button id="crew-depth-close" style="background:#223;color:#cfe3ff;border:1px solid #456">✕</button></div>';
    if (!list.length) {
      html += '<div class="dim" style="margin-top:8px">No crew aboard. Hire at any station.</div>';
    } else {
      for (var i = 0; i < list.length; i++) html += renderRowHTML(list[i]);
    }
    html += '<div class="dim" style="margin-top:8px">' + escHtml(perkSummary(_panelShip)) + '</div>';
    el.innerHTML = html;
    document.body.appendChild(el);
    var btn = document.getElementById('crew-depth-close');
    if (btn) btn.addEventListener('click', function () {
      var p = document.getElementById('crew-depth-panel');
      if (p) p.remove();
    });
    return el;
  }

  /* Refresh an open panel after crew changes (re-open if closed). */
  function refreshPanel() {
    var el = document.getElementById('crew-depth-panel');
    if (!el) return;
    el.remove();
    showRosterPanel(_panelShip);
  }

  return {
    ROLE_INFO: ROLE_INFO,
    power: power,
    totalPower: totalPower,
    hireCost: hireCost,
    make: make,
    rollStars: rollStars,
    rollRole: rollRole,
    rollRoster: rollRoster,
    killMembers: killMembers,
    count: count,
    roleName: roleName,
    roleColor: roleColor,
    /* crew-depth additions */
    ensure: ensure,
    mood: mood,
    moodOf: moodOf,
    moraleFactor: moraleFactor,
    rankTitle: rankTitle,
    statusLine: statusLine,
    perks: perks,
    recalcPerks: recalcPerks,
    perkSummary: perkSummary,
    grantXP: grantXP,
    onKill: onKill,
    onContract: onContract,
    onMissionWon: onMissionWon,
    onMissionLost: onMissionLost,
    onMemberDeath: onMemberDeath,
    tickIdle: tickIdle,
    onPrestige: onPrestige,
    renderRowHTML: renderRowHTML,
    showRosterPanel: showRosterPanel,
    refreshPanel: refreshPanel,
    DEPTH: {
      moraleDefault: MORALE_DEFAULT, xpPerKill: XP_PER_KILL,
      xpPerContract: XP_PER_CONTRACT, lvl2xp: LVL2_XP, lvl3xp: LVL3_XP
    }
  };
})();

/* --- crew-depth integration hooks (documented, not wired — ship.js,
 * quests.js, station.js, main.js and campaign.js are outside this file's
 * scope; see REPORT.md):
 *   station.js hire flow   -> SF.Crew.recalcPerks(ship) after hiring
 *   quests.js turnIn       -> SF.Crew.onMissionWon(ship) / onContract(ship, xp)
 *   ship death / GAMEOVER  -> SF.Crew.onMissionLost(ship)
 *   ship.js crew depletion -> SF.Crew.onMemberDeath(ship, dead)
 *   main.js per-frame tick -> occasional SF.Crew.tickIdle(ship)
 *   campaign.js NG+ accept -> SF.Crew.onPrestige(ship)
 *   station crew panel     -> SF.Crew.renderRowHTML(m) rows
 */

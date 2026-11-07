/* STARFALL Phase 1 — main.js
 * Game loop (fixed timestep), state machine: TITLE, PLAYING, DOCKED, STARMAP, GAMEOVER.
 * Owns the world: camera, starfield, collisions, patrol spawns, pause-on-hidden.
 */
window.SF = window.SF || {};

SF.Game = (function () {
  var canvas, ctx;
  var dpr = 1, vw = 0, vh = 0;
  var last = 0, acc = 0;
  var paused = false;
  var modalPaused = false; // encounter-pause-1: sim frozen while a modal is open
  var camX = 0, camY = 0;
  var stars = [];
  var patrolTimer = 6;
  var time = 0;
  // crew-depth-wiring: dry-spell accumulator for the idle-morale tick
  var crewIdleT = 0;

  var G = {
    state: 'TITLE',
    systemId: 'solace',
    discovered: ['solace'],
    dockedAt: null, // Phase 4: station label the player last docked at
    waypoint: null // Phase 5: {systemId, x, y, label, mission} homebase mission waypoint
  };

  function $(id) { return document.getElementById(id); }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* graphics-juice: 3 parallax planes (far / mid / near). Low quality draws layer 0 only. */
  function makeStars() {
    stars.length = 0;
    var layers = [
      { n: 90, par: 0.06, sMax: 1, alpha: 0.45, color: '#9db8dd' }, // far
      { n: 80, par: 0.20, sMax: 2, alpha: 0.75, color: '#cfe4ff' }, // mid
      { n: 50, par: 0.45, sMax: 2, alpha: 1.0,  color: '#ffffff' }  // near
    ];
    for (var L = 0; L < layers.length; L++) {
      for (var i = 0; i < layers[L].n; i++) {
        // b3-environment: near-plane depth variation — a few near stars
        // are larger (5% at 3px, 15% at 2px, rest 1px) so the near plane
        // reads as closer without adding star buckets (bucket keys are
        // color|alpha only, so the fill-call count is unchanged).
        var sr = Math.random();
        var ssz = L === 2 ? (sr < 0.05 ? 3 : (sr < 0.20 ? 2 : 1))
                          : (sr < 0.15 ? layers[L].sMax : 1);
        stars.push({
          x: Math.random(), y: Math.random(),
          par: layers[L].par * (0.85 + Math.random() * 0.3),
          s: ssz,
          tw: Math.random() * Math.PI * 2,
          layer: L,
          alpha: layers[L].alpha,
          color: layers[L].color
        });
      }
    }
  }

  function showOnly(id) {
    ['overlay-title', 'overlay-store', 'overlay-starmap', 'overlay-gameover',
     'overlay-boarding', 'overlay-quests', 'overlay-dialogue',
     'overlay-intro', 'overlay-surface', 'overlay-news',
     'overlay-blackmarket'].forEach(function (o) {
      $(o).classList.toggle('hidden', o !== id);
    });
    // hail-pause-2: keep the modal registry in sync with showOnly, the
    // only other path that toggles overlay visibility (state changes).
    modalOpenIds = {};
    if (id !== null) modalOpenIds[id] = true;
    if (id !== null) SF.HUD.hidePrompts();
  }

  function setState(s) {
    G.state = s;
    if (s === 'TITLE') { showOnly('overlay-title'); SF.HUD.showHud(false); }
    else if (s === 'PLAYING') { showOnly(null); SF.HUD.showHud(true); }
    else if (s === 'DOCKED') { showOnly('overlay-store'); SF.HUD.showHud(false); }
    else if (s === 'STARMAP') { SF.Starmap.open(); SF.HUD.showHud(false); }
    else if (s === 'BOARDING') { showOnly('overlay-boarding'); SF.HUD.showHud(false); }
    else if (s === 'GAMEOVER') { showOnly('overlay-gameover'); SF.HUD.showHud(false); }
    // refresh continue button visibility on title
    if (s === 'TITLE') $('btn-continue').disabled = !SF.Save.has();
    // mining-minigame: drop any armed timing bar across state changes
    if (window.SF && SF.MiningBar) SF.MiningBar.reset();
  }

  function enterSystem(systemId, spawnX, spawnY) {
    G.systemId = systemId;
    if (G.discovered.indexOf(systemId) < 0) {
      G.discovered.push(systemId);
      SF.HUD.toast('Discovered: ' + SF.SYSTEM_BY_ID[systemId].name);
    }
    var st = SF.Station.getStation(systemId);
    var keepClear = st ? [{ x: st.x, y: st.y }] : [];
    SF.Asteroids.init(systemId, keepClear);
    SF.Enemies.clear();
    SF.Projectiles.clear();
    SF.Particles.clear();
    SF.Pickups.clear();
    SF.FX.setSystem(systemId); // graphics-juice: per-system nebula
    if (spawnX === undefined) {
      // spawn away from station
      var a = Math.random() * Math.PI * 2;
      var base = st || { x: SF.CONFIG.worldSize / 2, y: SF.CONFIG.worldSize / 2 };
      spawnX = base.x + Math.cos(a) * 700;
      spawnY = base.y + Math.sin(a) * 700;
    }
    var ws = SF.CONFIG.worldSize;
    SF.Player.x = Math.max(60, Math.min(ws - 60, spawnX));
    SF.Player.y = Math.max(60, Math.min(ws - 60, spawnY));
    patrolTimer = 5 + Math.random() * 5;
    // gameplay-depth: reset the encounter scheduler on system entry
    if (window.SF && SF.Encounters) SF.Encounters.reset();
    // wormhole-travel-retry-3: (re)seed unstable wormholes for this system
    if (window.SF && SF.Wormholes) SF.Wormholes.onEnterSystem(systemId);
  }

  function newGame() {
    SF.Save.wipe();
    SF.Player.create();
    // wormhole-travel-retry-3: clear any prior session's wormhole layout
    if (window.SF && SF.Wormholes) SF.Wormholes.reset();
    // death-legacy-retry: legacy bonus for new pilots (separate storage, save-neutral)
    if (window.SF && SF.Legacy) SF.Legacy.applyNewPilotBonus();
    G.discovered = ['solace'];
    var st = SF.Station.getStation('solace');
    enterSystem('solace', st.x + 400, st.y);
    // story-campaign: new-game cinematic intro (skippable)
    if (window.SF && SF.Story && SF.Story.wantsIntro()) {
      SF.Story.playIntro();
    } else {
      setState('PLAYING');
      SF.HUD.toast('Welcome to Solace. Mine, fight, dock at Haven.');
    }
    if (SF.Audio && SF.Audio.startGame) SF.Audio.startGame();
  }

  function continueGame() {
    if (SF.Save.load()) {
      // SF.Player.deserialize already restored x/y; pass them through so enterSystem keeps them
      enterSystem(G.systemId, SF.Player.x, SF.Player.y);
      setState('PLAYING');
      SF.HUD.toast('Welcome back, pilot.');
    } else {
      newGame();
    }
  }

  function travelTo(systemId) {
    if (SF.Audio && SF.Audio.jumpCharge) SF.Audio.jumpCharge();
    // twelve-hour-wave1 (B5): a failed travel autosave must not be silent.
    var travelSaved = false;
    try { travelSaved = !!SF.Save.save(); } catch (e) { travelSaved = false; }
    enterSystem(systemId);
    setState('PLAYING');
    SF.HUD.toast('Jump complete: ' + SF.SYSTEM_BY_ID[systemId].name);
    /* Delayed, not immediate: SF.Game.travelTo is wrapped by starmap.js,
     * whose onArrival toasts (storm/blockade/interdict) fire synchronously
     * AFTER this function returns — an immediate warning toast would be
     * overwritten in the same task and never display. The 50 ms delay
     * lands the warning last, visible for the full toast duration. */
    if (!travelSaved) setTimeout(function () {
      if (SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26A0\uFE0F Autosave FAILED on jump — progress may not persist. Free up storage, then dock to save.');
    }, 50);
  }

  function onPlayerDeath() {
    SF.Particles.burst(SF.Player.x, SF.Player.y, '#ff8c2e', 40, 320, 0.9, 5);
    SF.Particles.burst(SF.Player.x, SF.Player.y, '#fff2cc', 20, 200, 0.6, 4);
    SF.FX.shake(14); // graphics-juice: big shake on player death
    SF.Audio.explosion(true);
    SF.Audio.gameOver();
    // crew-depth-wiring: ship death counts as a lost mission for crew morale
    if (window.SF && SF.Crew && SF.Crew.onMissionLost)
      SF.Crew.onMissionLost(SF.Player.ships[SF.Player.activeShip]);
    var lost = Math.floor(SF.Player.credits * SF.CONFIG.economy.respawnLoss);
    // death-legacy-retry: record the death (wreck beacon + insurance offer)
    var leg = null;
    if (window.SF && SF.Legacy) leg = SF.Legacy.onDeath();
    var keptOre = Math.max(0, Math.floor(SF.Player.ore) - (leg ? leg.lostOre : 0));
    $('gameover-stats').innerHTML =
      'Credits lost: <b>' + lost.toLocaleString('en-US') + '</b> (10%)<br>' +
      'Ore kept: <b>' + keptOre + '</b>' +
      (leg && leg.lostOre > 0 ? ' · <b>' + leg.lostOre + '</b> in the wreck' : '') +
      '<br>Ship & upgrades intact';
    if (window.SF && SF.HUD && SF.HUD.showDeathOffer) SF.HUD.showDeathOffer();
    setState('GAMEOVER');
  }

  /* Phase 3: distress rescue — tow an adrift ship to the nearest station. */
  function rescue() {
    var p = SF.Player;
    if (!p.isAdrift()) return;
    var cost = SF.CONFIG.crew.rescueCost;
    if (p.credits < cost) { SF.HUD.toast('Not enough credits for a tow.'); SF.Audio.deny(); return; }
    p.credits -= cost;
    p.ore = Math.floor(p.ore * (1 - SF.CONFIG.crew.rescueOreLoss));
    var st = SF.Station.getStation(G.systemId);
    p.x = st ? st.x + 400 : SF.CONFIG.worldSize / 2;
    p.y = st ? st.y : SF.CONFIG.worldSize / 2;
    SF.Audio.dock();
    SF.HUD.toast('Towed to ' + (st ? st.name : 'safety') + '. Hire crew!');
    SF.Save.save();
  }

  function respawn() {
    var keepUpgrades = Object.assign({}, SF.Player.upgrades);
    var keepWeapons = SF.Player.weaponsOwned.map(function (e) {
      return { id: e.id, stars: e.stars, mods: (e.mods || []).slice() };
    });
    var keepWepIdx = SF.Player.weaponIndex;
    var keepModsInv = Object.assign({}, SF.Player.modsInv || {});
    var keepInv = Object.assign({}, SF.Player.inventory);
    var keepShips = JSON.parse(JSON.stringify(SF.Player.ships));
    var keepActive = SF.Player.activeShip;
    var keepParts = Object.assign({}, SF.Player.partInventory);
    // death-legacy-retry: insurance buyback + wreck ore split (save-neutral)
    var delta = (window.SF && SF.Legacy) ? SF.Legacy.respawnDelta()
      : { lost: 0, lostOre: 0, insured: false };
    // insured pilots keep the full credit balance
    // (premium was already deducted at buyback time); the wreck's ore leaves
    // the kept total so it can be reclaimed at the beacon.
    var credits = delta.insured
      ? Math.floor(SF.Player.credits)
      : Math.floor(SF.Player.credits * (1 - SF.CONFIG.economy.respawnLoss));
    var ore = Math.max(0, Math.floor(SF.Player.ore) - (delta.lostOre || 0));
    // Phase 5: homebase, trading markets/goods, secrets persist through death
    var keepHomebase = SF.Player.homebase ? JSON.parse(JSON.stringify(SF.Player.homebase)) : null;
    var keepMarkets = JSON.parse(JSON.stringify(SF.Player.markets || {}));
    var keepGoods = Object.assign({}, SF.Player.goods || {});
    var keepSecrets = JSON.parse(JSON.stringify(SF.Player.secretsState || {}));
    // story-campaign: story progress survives death
    var keepStory = SF.Player.storyState ? JSON.parse(JSON.stringify(SF.Player.storyState)) : null;
    // gameplay-depth: bounty state survives death
    var keepBounties = SF.Player.bountyState ? JSON.parse(JSON.stringify(SF.Player.bountyState)) : null;
    // planets-facilities: news, contraband, black-market state survive death
    var keepNews = SF.Player.news ? JSON.parse(JSON.stringify(SF.Player.news)) : null;
    var keepContra = Object.assign({}, SF.Player.contraband || {});
    var keepBm = SF.Player.bmarket ? JSON.parse(JSON.stringify(SF.Player.bmarket)) : null;
    G.systemId = 'solace';
    SF.Player.create();
    SF.Player.upgrades = keepUpgrades;
    SF.Player.weaponsOwned = keepWeapons;
    SF.Player.weaponIndex = keepWepIdx;
    SF.Player.modsInv = keepModsInv; // weapons-arsenal: mods survive death
    SF.Player.inventory = keepInv;
    SF.Player.ships = keepShips;
    SF.Player.activeShip = keepActive;
    SF.Player.partInventory = keepParts;
    SF.Player.credits = credits;
    SF.Player.ore = ore;
    SF.Player.homebase = keepHomebase;
    SF.Player.markets = keepMarkets;
    SF.Player.goods = keepGoods;
    SF.Player.secretsState = keepSecrets;
    if (keepStory) SF.Player.storyState = keepStory;
    // gameplay-depth: bounties persist through death (active target stays at large)
    if (keepBounties) { SF.Player.bountyState.active = keepBounties.active;
      SF.Player.bountyState.done = keepBounties.done || 0; }
    var st = SF.Station.getStation('solace');
    enterSystem('solace', st.x + 400, st.y);
    setState('PLAYING');
    SF.HUD.toast('Towed to Haven Dock. Fly careful.');
    if (SF.Audio && SF.Audio.respawn) SF.Audio.respawn();
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    time += dt;
    SF.Input.poll();

    if (G.state === 'STARMAP') {
      if (SF.Input.consumeMapKey()) SF.Starmap.close();
      SF.Input.consumeDockKey();
      return;
    }
    if (G.state !== 'PLAYING') {
      // swallow stale keys so E/M/B don't leak across states (e.g. instant re-dock)
      SF.Input.consumeDockKey();
      SF.Input.consumeMapKey();
      SF.Input.consumeBoardKey();
      SF.Input.consumeQuestKey();
      if (window.SF && SF.Input.consumeNewsKey) SF.Input.consumeNewsKey();
      return;
    }
    if (SF.Input.consumeMapKey()) { setState('STARMAP'); return; }
    // Phase 4: quest log — beta2-qkey: the consume path is itself a
    // toggle, so a questKey that reaches here while the panel is somehow
    // already open closes it instead of re-rendering it open. (The live
    // path is the keydown toggle in input.js, which fires while frame()
    // is modal-paused; this branch is defence in depth and is normally
    // reached only with the panel closed.)
    if (SF.Input.consumeQuestKey()) {
      var qOpen = !!modalOpenIds['overlay-quests'];
      if (!qOpen) {
        try { var qel = document.getElementById('overlay-quests');
          qOpen = !!(qel && !qel.classList.contains('hidden')); } catch (e) {}
      }
      if (qOpen) SF.Quests.closeLog(); else SF.Quests.openLog();
      return;
    }
    // planets-facilities: news overlay
    if (window.SF && SF.News && SF.Input.consumeNewsKey()) { SF.News.open(); return; }

    var p = SF.Player;

    // dock key (Phase 5: multi-station + derelict/anomaly investigate on E)
    if (SF.Input.consumeDockKey()) {
      var near = SF.Station.nearStation(p, G.systemId);
      if (near && near.dist <= SF.CONFIG.station.dockRadius) { SF.Station.dock(near.st); return; }
      var sec = SF.Secrets.nearSecret(p, G.systemId);
      if (sec) { SF.Secrets.investigate(sec); return; }
    }

    // Phase 3: boarding key — board a crippled/adrift enemy in range
    if (SF.Input.consumeBoardKey()) {
      var bt = SF.Boarding.findTarget(p);
      if (bt) { SF.Boarding.open(bt); return; }
    }

    p.update(dt, SF.Input);
    // open-space-1: seamless region crossing — the shift moves every live
    // entity into the new region's frame, so the camera must move by the
    // same delta or the view would sweep across the void for a beat.
    var xShift = null;
    try { if (window.SF && SF.Space) xShift = SF.Space.checkCrossing(); } catch (e) {}
    if (xShift) { camX += xShift.dx; camY += xShift.dy; }
    // crew-depth-wiring: dry-spell decay — occasional idle tick on the active
    // ship's crew (10 in-game minutes of PLAYING flight; -2 morale, floors at 5)
    crewIdleT += dt;
    if (crewIdleT >= 600) {
      crewIdleT = 0;
      if (window.SF && SF.Crew && SF.Crew.tickIdle)
        SF.Crew.tickIdle(p.ships[p.activeShip]);
    }
    SF.Enemies.update(dt, p, SF.CONFIG.worldSize);
    SF.Projectiles.update(dt, SF.CONFIG.worldSize);    SF.Particles.update(dt);
    SF.FX.update(dt); // graphics-juice: decay screen shake
    if (window.SF && SF.FX && SF.FX.updateNumbers) SF.FX.updateNumbers(dt); // b2-combat-feedback: damage-number clock
    SF.Asteroids.update(dt, p);
    SF.Pickups.update(dt, p);
    // death-legacy-retry: wreck beacon proximity reclaim
    if (window.SF && SF.Legacy) SF.Legacy.update();
    // wormhole-travel-retry-3: drift + proximity transit
    if (window.SF && SF.Wormholes) SF.Wormholes.update(dt);
    // Phase 4: wingman companions
    SF.Companions.update(dt);
    // story-campaign: story waypoints / scripted encounters / ore tracking
    if (window.SF && SF.Story) SF.Story.update(dt);

    // random encounters v2 (gameplay-depth): weighted per-system tables,
    // escalation chains, difficulty scaling, bounty target spawns
    if (window.SF && SF.Encounters) {
      SF.Encounters.tick(dt);
    } else {
      patrolTimer -= dt;
      if (patrolTimer <= 0) {
        patrolTimer = SF.CONFIG.patrolInterval[0] +
          Math.random() * (SF.CONFIG.patrolInterval[1] - SF.CONFIG.patrolInterval[0]);
        if (SF.Enemies.list.length < SF.CONFIG.patrolCap) {
          SF.Enemies.spawnPatrol(G.systemId, p.x, p.y);
        }
      }
    }

    collisions();

    // mining-minigame: sweet-spot timing bar tick (save-neutral, additive)
    if (window.SF && SF.MiningBar) SF.MiningBar.update(dt, SF.Input.firing);

    // dock prompt (planets-facilities: pass the station entry for LAND/DOCK wording)
    var ns = SF.Station.nearStation(p, G.systemId);
    if (ns) SF.HUD.showDockPrompt(true, ns.dist <= SF.CONFIG.station.dockRadius, ns.st);
    else SF.HUD.showDockPrompt(false, false, null);

    // Phase 5: investigate prompt (derelicts / anomaly) + homebase waypoint arrival
    SF.HUD.showInvestigatePrompt(SF.Secrets.nearSecret(p, G.systemId));
    SF.Homebase.checkArrival();

    // Phase 3: board prompt for a crippled/adrift enemy in range
    SF.HUD.showBoardPrompt(SF.Boarding.findTarget(p));

    // camera follows player
    camX += (p.x - vw / 2 - camX) * Math.min(1, 6 * dt);
    camY += (p.y - vh / 2 - camY) * Math.min(1, 6 * dt);

    // final-kill-slowmo-retry: install the additive SF.Enemies.kill wrap
    if (window.SF && SF.Finisher) SF.Finisher.install();
    // afterburner-boost: install the additive SF.Player.update wrap
    if (window.SF && SF.Afterburner) SF.Afterburner.install();
    // pirate-parley: install the additive SF.Enemies.damage wrap
    if (window.SF && SF.Parley) SF.Parley.install();

    SF.HUD.update();
  }

  /* weapons-arsenal phase: EMP/blast/mine handling on projectile collisions. */
  function applyWeaponFx(pr, e) {
    if (pr.blast > 0) SF.Projectiles.detonate(pr);
    if (pr.emp > 0) {
      e.empTimer = Math.max(e.empTimer || 0, pr.emp);
      SF.Particles.burst(e.x, e.y, '#d28aff', 10, 180, 0.5, 3);
      SF.Audio.emp();
    }
  }

  function collisions() {
    var p = SF.Player;
    var pool = SF.Projectiles.pool;
    var i, j, pr;

    for (i = 0; i < pool.length; i++) {
      pr = pool[i];
      if (!pr.active) continue;
      if (pr.friendly) {
        // mines: proximity fuse when armed (enemies only, per spec)
        if (pr.mine && pr.armed) {
          var el2 = SF.Enemies.list;
          var fused = false;
          for (j = 0; j < el2.length; j++) {
            var dx2 = pr.x - el2[j].x, dy2 = pr.y - el2[j].y;
            if (dx2 * dx2 + dy2 * dy2 < 70 * 70) { fused = true; break; }
          }
          if (fused) { pr.active = false; SF.Projectiles.detonate(pr); continue; }
        }
        // vs enemies
        var el = SF.Enemies.list;
        for (j = el.length - 1; j >= 0; j--) {
          var e = el[j];
          var dx = pr.x - e.x, dy = pr.y - e.y;
          var rr = pr.radius + e.radius;
          if (dx * dx + dy * dy < rr * rr) {
            pr.active = false;
            if (pr.mine) { SF.Projectiles.detonate(pr); }
            else { SF.Enemies.damage(e, pr.dmg, pr.crit); applyWeaponFx(pr, e); }
            break;
          }
        }
        if (!pr.active) continue;
        // vs asteroids
        var al = SF.Asteroids.list;
        for (j = 0; j < al.length; j++) {
          var a = al[j];
          if (a.dead) continue;
          var ax = pr.x - a.x, ay = pr.y - a.y;
          var ar = pr.radius + a.r;
          if (ax * ax + ay * ay < ar * ar) {
            pr.active = false;
            if (pr.mine) SF.Projectiles.detonate(pr);
            else { SF.Asteroids.damage(a, pr.dmg, pr.kind === 'beam'); // mining-minigame: beam flag
              if (pr.blast > 0) SF.Projectiles.detonate(pr); }
            break;
          }
        }
      } else {
        // enemy projectile vs player
        if (!p.alive) continue;
        var px = pr.x - p.x, py = pr.y - p.y;
        var prad = pr.radius + p.radius;
        if (px * px + py * py < prad * prad) {
          pr.active = false;
          p.takeDamage(pr.dmg);
        }
      }
    }
  }

  /* ---------------- render ---------------- */

  function render() {
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, vw, vh);
    if (G.state === 'TITLE') {
      // b3-environment: paint the preloaded title_nebula art behind the
      // title UI (the game canvas is display:none on title — the visible
      // copy is painted by the title-starfield script in index.html —
      // but this keeps the game canvas itself correct if ever shown).
      // Procedural starfield stays on top as the twinkle layer; on Low
      // tier or while the art loads, drawTitleVista is a no-op and the
      // starfield alone is the fallback.
      if (window.SF && SF.FX && SF.FX.drawTitleVista) SF.FX.drawTitleVista(ctx, vw, vh);
      drawStarfield(0, 0); return;
    }

    SF.FX.drawNebula(ctx, camX, camY, vw, vh); // graphics-juice: nebula backdrop
    drawStarfield(camX, camY);

    ctx.save();
    var sh = SF.FX.offset(); // graphics-juice: screen shake
    // final-kill-slowmo-retry: ease a 1.6x zoom onto the kill point during
    // the finisher beat; the focus pans from the player to the kill point.
    var fz = (window.SF && SF.FX && SF.FX.finisherZoom) ? SF.FX.finisherZoom() : 1;
    if (fz > 1.001) {
      var ff = SF.FX.finisherFocus();
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(fz, fz);
      ctx.translate(-ff.x - sh.x, -ff.y - sh.y);
    } else {
      ctx.translate(-Math.round(camX + sh.x), -Math.round(camY + sh.y));
    }

    SF.Station.draw(ctx, G.systemId, time);
    SF.Secrets.draw(ctx, G.systemId, time); // Phase 5: derelicts + anomaly
    // wormhole-travel-retry-3: unstable wormholes (swirl + hint label)
    if (window.SF && SF.Wormholes) SF.Wormholes.draw(ctx);
    SF.Asteroids.draw(ctx);
    SF.Pickups.draw(ctx, time);
    // death-legacy-retry: wreck recovery beacons
    if (window.SF && SF.Legacy) SF.Legacy.draw(ctx);
    SF.Enemies.draw(ctx);
    SF.Projectiles.draw(ctx);
    SF.Player.draw(ctx);
    SF.Companions.draw(ctx); // Phase 4: wingmen
    SF.Particles.draw(ctx);
    // b2-combat-feedback: floating damage numbers (world space, PLAYING only)
    if (G.state === 'PLAYING' && window.SF && SF.FX && SF.FX.drawNumbers) SF.FX.drawNumbers(ctx);
    if (window.SF && SF.Story) SF.Story.draw(ctx, time); // story-campaign: waypoint marker

    // dock radius hints (Phase 5: all stations)
    SF.Station.allStations(G.systemId).forEach(function (st) {
      ctx.save();
      ctx.strokeStyle = 'rgba(57,213,232,0.25)';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(st.x, st.y, SF.CONFIG.station.dockRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // twelve-hour-wave1: Haven safe-bubble edge — one dashed arc, rookie
    // Solace only (same draw pattern as the dock hints above, no new
    // per-frame allocations beyond the save/restore). Pairs with
    // SF.HavenWatch's exit/re-entry toasts so the first difficulty spike
    // is never an unexplained death.
    if (G.systemId === 'solace' && window.SF && SF.Enemies && SF.Enemies.rookieFactor) {
      try {
        if (SF.Enemies.rookieFactor('solace').active && SF.SYSTEM_BY_ID && SF.SYSTEM_BY_ID.solace) {
          var hs = SF.SYSTEM_BY_ID.solace.station;
          var hr = (SF.CONFIG.rookie && SF.CONFIG.rookie.havenRange) || 650;
          if (hs) {
            ctx.save();
            ctx.strokeStyle = 'rgba(125,249,255,0.35)';
            ctx.setLineDash([14, 10]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hs.x, hs.y, hr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      } catch (e) { /* ring is cosmetic; never break the frame */ }
    }

    ctx.restore();

    // final-kill-slowmo-retry: desaturation flash in screen space at the
    // start of the finisher beat.
    if (window.SF && SF.FX && SF.FX.drawFinisherFlash) SF.FX.drawFinisherFlash(ctx, vw, vh);

    // mining-minigame: timing bar in screen space, near the reticle
    if (window.SF && SF.MiningBar && G.state === 'PLAYING') {
      var pa = SF.Input.aimActive ? SF.Input.aimAngle : SF.Player.angle;
      SF.MiningBar.draw(ctx, vw, vh, SF.Player.x - camX, SF.Player.y - camY, pa);
    }
  }

  /* balance-perf: star buckets persist across frames; each holds a flat
   * [x, y, size] list, reset every frame. One fill per color+alpha bucket. */
  var starBk = {}, starUsed = [];

  function drawStarfield(cx, cy) {
    ctx.save();
    var maxLayer = (window.SF && SF.FX) ? SF.FX.starLayers() : 3;
    starUsed.length = 0;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.layer >= maxLayer) continue;
      var x = ((s.x * vw - cx * s.par) % vw + vw) % vw;
      var y = ((s.y * vh - cy * s.par) % vh + vh) % vh;
      var tw = 0.5 + 0.5 * Math.sin(time * 2 + s.tw);
      var al = (0.25 + 0.55 * tw * s.par) * s.alpha;
      var aq = (al * 8) | 0; if (aq > 7) aq = 7;
      var key = s.color + '|' + aq;
      var b = starBk[key];
      if (!b) { b = starBk[key] = []; }
      if (b.length === 0) starUsed.push(key);
      b.push(x, y, s.s);
    }
    for (var k = 0; k < starUsed.length; k++) {
      var kk = starUsed[k], bb = starBk[kk];
      var sep = kk.lastIndexOf('|');
      /* (aq+1)/8 keeps the faintest twinkle stars visible (legacy min ~0.11) */
      ctx.globalAlpha = ((+kk.slice(sep + 1)) + 1) / 8;
      ctx.fillStyle = kk.slice(0, sep);
      ctx.beginPath();
      for (var j = 0; j < bb.length; j += 3) ctx.rect(bb[j], bb[j+1], bb[j+2], bb[j+2]);
      ctx.fill();
      bb.length = 0;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- loop ---------------- */

  // hail-pause-2: explicit game-level modal tracking. encounter-pause-1
  // gated frame() on a DOM query ('.overlay:not(.hidden)'), which is
  // correct in the sandbox but fragile by construction: any overlay shown
  // through a path that doesn't toggle that class (or a stale cached
  // script on device) silently defeats the pause while the modal still
  // eats input. The gate now keys FIRST on flags the game itself sets —
  // the overlay registry below, Parley's hailOpen, SF.Dialog's open
  // state — with the DOM query kept only as a backstop.
  var modalOpenIds = {};
  function modalFlagged() {
    for (var k in modalOpenIds) if (modalOpenIds.hasOwnProperty(k)) return true;
    try {
      if (window.SF && SF.Parley && typeof SF.Parley.state === 'function' &&
          SF.Parley.state().hailOpen) return true;
    } catch (e) {}
    try {
      if (window.SF && SF.Dialog && typeof SF.Dialog.isOpen === 'function' &&
          SF.Dialog.isOpen()) return true;
    } catch (e2) {}
    return false;
  }

  // encounter-pause-1: true when a blocking modal/panel is open during
  // PLAYING. Any visible .overlay counts (dialogue, boarding, quest log /
  // codex, news, skills, settings, builder, store, surface), plus the
  // SF.Dialog DOM modal (not an .overlay) via its isOpen hook. Small HUD
  // prompts (dock/board/investigate buttons), toasts, the killfeed and the
  // combat feed are NOT overlays and never pause.
  function modalBlocking() {
    if (!G || G.state !== 'PLAYING') return false;
    if (modalFlagged()) return true;
    try {
      if (document.querySelector('.overlay:not(.hidden)')) return true;
      var d = document.getElementById('sf-dialog');
      if (d && !d.classList.contains('hidden')) return true;
    } catch (e) {}
    return false;
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (paused) return;
    // encounter-pause-1: a blocking modal during PLAYING freezes the sim
    // (enemies, projectiles, collisions, damage, timers) while the DOM modal
    // itself stays interactive and the frozen scene stays painted behind it.
    // Without this, a mid-combat popup (e.g. a surrender hail) left the sim
    // running while the overlay ate all touch input.
    if (modalBlocking()) {
      modalPaused = true;
      render();
      return;
    }
    if (modalPaused) {
      // Modal just closed: resume cleanly — no dt spike (same as the
      // visibility-resume path) and no held touch state carried over from
      // behind the modal (stuck-fire / stuck-stick).
      modalPaused = false;
      last = 0;
      try { if (window.SF && SF.Input && SF.Input.clearHeld) SF.Input.clearHeld(); } catch (e2) {}
    }
    if (!last) last = t;
    var dt = (t - last) / 1000;
    last = t;
    if (dt > 0.25) dt = 0.25; // tab-switch clamp
    // final-kill-slowmo-retry: the finisher beat runs on REAL time while the
    // game itself runs at timeScale() (0.25x during the beat).
    if (window.SF && SF.FX && SF.FX.updateFinisher) SF.FX.updateFinisher(dt);
    var ts = (window.SF && SF.FX && SF.FX.timeScale) ? SF.FX.timeScale() : 1;
    acc += dt * ts;
    var step = SF.CONFIG.step;
    var n = 0;
    while (acc >= step && n < 5) {
      update(step);
      acc -= step;
      n++;
    }
    if (n === 5) acc = 0; // spiral-of-death guard
    render();
  }

  /* ---------------- init ---------------- */

  function init() {
    canvas = $('game');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
    makeStars();

    SF.Projectiles.init();
    SF.Particles.init();
    SF.FX.init(); // graphics-juice: quality tiers, shake, nebula
    SF.Pickups.init();
    SF.Input.init();
    SF.HUD.init();
    SF.Player.create();

    $('btn-new').addEventListener('click', function () {
      SF.Audio.unlock(); SF.Audio.ui(); newGame();
    });
    $('btn-continue').addEventListener('click', function () {
      SF.Audio.unlock(); SF.Audio.ui(); continueGame();
    });
    $('btn-respawn').addEventListener('click', function () {
      SF.Audio.unlock(); SF.Audio.ui(); respawn();
    });
    $('btn-undock').addEventListener('click', function () { SF.Station.undock(); });
    $('btn-starmap-close').addEventListener('click', function () { if (SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack(); SF.Starmap.close(); });
    $('btn-quests-close').addEventListener('click', function () { if (SF.Audio && SF.Audio.uiBack) SF.Audio.uiBack(); SF.Quests.closeLog(); });
    $('title-mute').addEventListener('click', function () {
      var m = SF.Audio.toggleMute();
      $('title-mute').textContent = m ? '🔇 sound off' : '🔊 sound on';
    });
    $('title-mute').textContent = SF.Audio.isMuted() ? '🔇 sound off' : '🔊 sound on';
    // graphics-juice: quality toggle (auto / high / low) on the title screen
    var qbtn = $('title-quality');
    function paintQuality() { qbtn.textContent = '✨ quality: ' + SF.FX.getSetting(); }
    qbtn.addEventListener('click', function () {
      SF.Audio.unlock(); SF.Audio.ui(); SF.FX.cycle(); paintQuality();
    });
    paintQuality();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        paused = true;
        // twelve-hour-wave1 (B5): surface a failed background autosave too
        // (the toast is visible on return; dock/travel re-warn regardless).
        if (G.state === 'PLAYING') {
          var bgSaved = false;
          try { bgSaved = !!SF.Save.save(); } catch (e) { bgSaved = false; }
          if (!bgSaved && SF.HUD && SF.HUD.toast) SF.HUD.toast('\u26A0\uFE0F Autosave FAILED — progress may not persist. Free up storage, then dock to save.');
        }
      } else {
        paused = false;
        last = 0;
      }
    });

    // title screen starfield drift
    setState('TITLE');
    requestAnimationFrame(frame);
  }

  return {
    get state() { return G.state; },
    get systemId() { return G.systemId; },
    set systemId(v) { G.systemId = v; },
    get discovered() { return G.discovered; },
    set discovered(v) { G.discovered = v; },
    get dockedAt() { return G.dockedAt; }, // Phase 4
    set dockedAt(v) { G.dockedAt = v; }, // Phase 4
    get waypoint() { return G.waypoint; }, // Phase 5
    set waypoint(v) { G.waypoint = v; }, // Phase 5
    // Phase 4: overlay helpers for quest log / dialogue (do not disturb setState)
    // hail-pause-2: show/hideOverlay maintain the modal registry that
    // modalBlocking() keys on, so the pause no longer depends on DOM classes.
    showOverlay: function (id) { var el = $(id); if (el) el.classList.remove('hidden'); if (id) modalOpenIds[id] = true; },
    hideOverlay: function (id) { var el = $(id); if (el) el.classList.add('hidden'); if (id) delete modalOpenIds[id]; },
    // beta2-tribute: build stamp (proves the packaged script carries
    // the hail keyboard fix, not a stale cached copy — the hail-pause-2
    // device failure mode, now applied to the PC/Linux build too).
    BUILD: 'beta2',
    modalBlocking: function () { return modalBlocking(); },
    modalOpenIds: function () { return Object.keys(modalOpenIds); },
    init: init,
    setState: function (s) { setState(s); },
    travelTo: travelTo,
    onPlayerDeath: onPlayerDeath,
    rescue: rescue,
    newGame: newGame
  };
})();

/* mining-minigame phase — SF.MiningBar
 * Asteroid mining sweet-spot timing minigame. Purely additive: wraps
 * SF.Asteroids.damage and SF.Pickups.spawnOre at runtime. All code lives in
 * this file; no other phase file is touched.
 * While a beam-kind projectile ("mining beam") is hitting an asteroid, a
 * small timing bar renders near the reticle. Releasing fire with the marker
 * inside the green zone banks 2x ore yield on that rock's break; dead-center
 * of the zone banks 3x plus a spark burst (SF.Particles + SF.FX.shake).
 * A release outside the zone keeps the base yield. The marker speeds up and
 * the zone drifts / narrows on richer (bigger) asteroids. Save-neutral:
 * no SF.SAVE_VERSION bump, no save-blob changes.
 * Distinct from encounter-variety's cargo-cache claim minigame (a latch
 * minigame on drifting caches in js/gameplay.js): this is release-timing on
 * mining yields, beam-gated.
 */
SF.MiningBar = (function () {
  var BAR_W = 140, BAR_H = 12;
  var HOLD_TIMEOUT = 0.45; // s without a beam hit before the bar hides

  var installed = false;
  var active = false, target = null, lastBeamT = 0;
  var m = 0.5, mdir = 1, speed = 1.0;  // marker ping-pong
  var cz = 0.5, cdir = 1, drift = 0.1; // green-zone center drift
  var greenHW = 0.13, perfectHW = 0.028;
  var wasFiring = false;
  var resultT = 0, resultText = '', resultColor = '#fff';
  var counting = false, countN = 0;

  function now() { return performance.now() / 1000; }

  function richness(a) {
    var cfg = SF.CONFIG.asteroid;
    return Math.max(0, Math.min(1,
      (a.r - cfg.radiusMin) / Math.max(1, cfg.radiusMax - cfg.radiusMin)));
  }

  function arm(a) {
    var rich = richness(a);
    target = a; active = true; lastBeamT = now();
    m = Math.random(); mdir = Math.random() < 0.5 ? -1 : 1;
    speed = 0.85 + 1.5 * rich;     // richer rocks: faster marker
    cz = 0.30 + Math.random() * 0.40; cdir = Math.random() < 0.5 ? -1 : 1;
    drift = 0.10 + 0.35 * rich;    // richer rocks: drifting zone
    greenHW = 0.14 - 0.05 * rich;  // richer rocks: tighter green
    perfectHW = 0.028;
  }

  function resolve() { // fire released while the bar is armed
    if (!active || !target || target.dead) { active = false; target = null; return; }
    var d = Math.abs(m - cz);
    var mult = 1, txt = '1x ore', col = '#9aa3b2';
    if (d <= perfectHW) {
      mult = 3; txt = 'PERFECT 3x'; col = '#ffd23f';
      SF.Particles.sparks(target.x, target.y, '#ffd23f');
      SF.Particles.burst(target.x, target.y, '#fff2cc', 26, 260, 0.7, 4);
      if (SF.FX && SF.FX.shake) SF.FX.shake(5);
      if (SF.Audio && SF.Audio.mine) SF.Audio.mine();
      /* voice-wiring-v6: pack-6 mining result lines, guarded, save-neutral */
      if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('mineperfect', 2); } catch (e) {} }
    } else if (d <= greenHW) {
      mult = 2; txt = 'SWEET SPOT 2x'; col = '#7dff8a';
      SF.Particles.sparks(target.x, target.y, '#7dff8a');
      if (SF.Audio && SF.Audio.mine) SF.Audio.mine();
      /* voice-wiring-v6: pack-6 mining result lines, guarded, save-neutral */
      if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('minesweet', 3); } catch (e) {} }
    } else {
      /* voice-wiring-v6: pack-6 mining result lines, guarded, save-neutral */
      if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('minemiss', 2); } catch (e) {} }
    }
    if (mult > 1) target._mineMult = mult; // consumed when the rock breaks
    resultT = 1.1; resultText = txt; resultColor = col;
    active = false; target = null;
  }

  function install() {
    if (installed) return; installed = true;
    var origSpawn = SF.Pickups.spawnOre;
    var origDamage = SF.Asteroids.damage;
    SF.Pickups.spawnOre = function (x, y, amount) {
      if (counting) countN += (amount || 1);
      return origSpawn.call(SF.Pickups, x, y, amount);
    };
    SF.Asteroids.damage = function (a, dmg, isBeam) {
      if (a.dead) return origDamage.call(SF.Asteroids, a, dmg);
      if (isBeam) { // mining beam is on this rock (flagged at the call site)
        if (active && target === a) lastBeamT = now(); // keep the bar alive
        else arm(a);
      }
      var willDie = (a.hp - dmg) <= 0;
      var mult = (willDie && a._mineMult > 1) ? a._mineMult : 1;
      countN = 0; counting = true;
      var r = origDamage.call(SF.Asteroids, a, dmg);
      counting = false;
      if (a.dead) {
        // countN holds the base ore this death spawned (the only
        // spawnOre calls in this stack come from asteroids.js).
        if (mult > 1 && countN > 0) {
          var extra = countN * (mult - 1);
          for (var i = 0; i < extra; i++) {
            origSpawn.call(SF.Pickups,
              a.x + (Math.random() - 0.5) * a.r * 0.8,
              a.y + (Math.random() - 0.5) * a.r * 0.8, 1);
          }
        }
        a._mineMult = 0;
      }
      return r;
    };
  }

  return {
    update: function (dt, firing) {
      install();
      if (active) {
        if (!target || target.dead || (now() - lastBeamT) > HOLD_TIMEOUT) {
          active = false; target = null;
        } else {
          m += mdir * speed * dt;
          if (m < 0) { m = 0; mdir = 1; } else if (m > 1) { m = 1; mdir = -1; }
          cz += cdir * drift * dt;
          if (cz < 0.18) { cz = 0.18; cdir = 1; }
          else if (cz > 0.82) { cz = 0.82; cdir = -1; }
        }
      }
      if (wasFiring && !firing) resolve(); // fire released
      wasFiring = !!firing;
      if (resultT > 0) resultT -= dt;
    },

    draw: function (ctx, vw, vh, sx, sy, aimAng) {
      var showBar = active;
      var showRes = resultT > 0 && resultText;
      if (!showBar && !showRes) return;
      var bx = sx + Math.cos(aimAng) * 78 - BAR_W / 2;
      var by = sy + Math.sin(aimAng) * 78 - 36;
      bx = Math.max(8, Math.min(vw - BAR_W - 8, bx));
      by = Math.max(34, Math.min(vh - 70, by));
      ctx.save();
      if (showBar) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx - 6, by - 24, BAR_W + 12, BAR_H + 38);
        ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('MINING', bx + BAR_W / 2, by - 10);
        ctx.fillStyle = '#1a2030';
        ctx.fillRect(bx, by, BAR_W, BAR_H);
        var gx = bx + (cz - greenHW) * BAR_W, gw = greenHW * 2 * BAR_W;
        ctx.fillStyle = 'rgba(80,255,120,0.45)';
        ctx.fillRect(gx, by, gw, BAR_H);
        ctx.fillStyle = '#ffd23f'; // perfect-center tick
        ctx.fillRect(bx + cz * BAR_W - 1, by - 2, 2, BAR_H + 4);
        var mx = bx + m * BAR_W;   // marker
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(mx - 1.5, by - 4, 3, BAR_H + 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(bx - 0.5, by - 0.5, BAR_W + 1, BAR_H + 1);
      }
      if (showRes) {
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        ctx.globalAlpha = Math.min(1, resultT * 2);
        ctx.fillStyle = resultColor;
        ctx.fillText(resultText, bx + BAR_W / 2, by + (showBar ? BAR_H + 20 : 6));
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },

    reset: function () { active = false; target = null; wasFiring = false; resultT = 0; },

    /* smoke-test introspection */
    state: function () {
      return { active: active, marker: m, zone: cz, greenHW: greenHW,
               perfectHW: perfectHW, speed: speed, drift: drift,
               result: resultText, resultT: resultT,
               banked: (target && target._mineMult) || 0 };
    }
  };
})();


/* final-kill-slowmo-retry phase — SF.Finisher (main.js only, additive).
 * Wraps SF.Enemies.kill at runtime: after the original kill resolution runs,
 * boss/elite kills trigger SF.FX.startFinisher(x, y) — the 1.2s cinematic
 * slow-mo beat. Gating:
 *   - only while PLAYING (kills resolved in menus/dock never slow-mo);
 *   - only boss kills (e.boss) and elite kills (e.elite); trash mobs pass
 *     through untouched;
 *   - never while the player is dead or below 25% hull (no slow-mo on the
 *     player's own death).
 * All state is runtime-only; save-neutral (no SF.SAVE_VERSION bump).
 * Installed once from SF.Game.update(); chains after the earlier kill wraps
 * (__df factions, __cg companion-gear, gameplay-depth encounter wraps).
 */
SF.Finisher = (function () {
  var installed = false;

  function install() {
    if (installed) return; installed = true;
    if (!window.SF || !SF.Enemies || !SF.FX) return;
    var origKill = SF.Enemies.kill;
    if (origKill && origKill.__fks) return;
    SF.Enemies.kill = function (e) {
      var kx = e.x, ky = e.y;
      var cinem = !!e.boss || !!e.elite;
      origKill.apply(this, arguments);
      if (!cinem || !SF.FX || !SF.FX.startFinisher) return;
      try {
        if (!SF.Game || SF.Game.state !== 'PLAYING') return;
        var p = SF.Player;
        if (!p || !p.alive) return;
        var mh = (typeof p.maxHull === 'function') ? p.maxHull() : 1;
        if (mh > 0 && (p.hull / mh) < 0.25) return;
        SF.FX.startFinisher(kx, ky);
      } catch (err) { /* never break kills */ }
    };
    SF.Enemies.kill.__fks = true;
  }

  return { install: install };
})();

/* wormhole-travel-retry-3 phase — SF.Wormholes (main.js only, additive).
 * Unstable wormholes: 0-2 drift per system (seeded per system, so the layout
 * is deterministic across re-entry), fly in -> jump to a random OTHER system
 * with a swirl visual (SF.Particles + SF.FX.shake/jumpFlashNow) and a seeded
 * risk roll: 70% clean, 20% hull -15% (shear bypasses shields), 10% dumped
 * into a pirate ambush (SF.Encounters.run('ambush') at runtime when present;
 * gameplay.js is NOT edited). Wormholes collapse after 3 uses. The HUD hint
 * reads 'unstable signature' — the destination is never shown. All state is
 * runtime-only; save-neutral (no SF.SAVE_VERSION bump, no save-blob keys).
 * Built on the existing jump path: transit calls SF.Game.travelTo(dest),
 * so the existing enterSystem/jump code is not refactored. Wormhole layout
 * persists per session across system visits (uses do not reset on re-entry).
 */
SF.Wormholes = (function () {
  var SYSTEMS = ['solace', 'drift', 'ember'];
  var MAX_USES = 3;
  var ENTRY_R = 95;    // proximity that triggers a transit
  var HINT_R = 420;    // proximity that fires the "unstable signature" hint

  var holesBySys = {}; // systemId -> [hole]; generated once per session per system
  var transits = [];   // session transit log (test introspection)
  var cooldown = 0;    // entry cooldown after any transit (avoids chain jumps)
  var armT = 0;        // arming delay after system entry

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function curHoles() { return holesBySys[SF.Game.systemId] || []; }

  function gen(sys) {
    var r = mulberry32(hashStr('wormholes:' + sys));
    var ws = SF.CONFIG.worldSize;
    var n = Math.floor(r() * 3); // 0..2
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push({
        x: 240 + r() * (ws - 480),
        y: 240 + r() * (ws - 480),
        vx: (r() - 0.5) * 16,
        vy: (r() - 0.5) * 16,
        seed: Math.floor(r() * 4294967296),
        uses: 0,
        hinted: false
      });
    }
    return arr;
  }

  /* Seeded destination + risk for hole with `uses` prior transits.
   * Mirrors the independent model used by smoke.mjs. */
  function outcome(sys, seed, uses) {
    var rng = mulberry32((seed ^ Math.imul(uses + 1, 0x9E3779B9)) >>> 0);
    var others = SYSTEMS.filter(function (s) { return s !== sys; });
    var dest = others[Math.floor(rng() * others.length) % others.length];
    var roll = rng();
    return { dest: dest, risk: roll < 0.70 ? 'clean' : (roll < 0.90 ? 'hull' : 'ambush') };
  }

  function sfx(id) {
    if (SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx(id); } catch (e) { /* fallback path handles it */ } }
  }

  function transit(i) {
    var sys = SF.Game.systemId;
    var hs = curHoles();
    var h = hs[i];
    if (!h) return;
    var pr = outcome(sys, h.seed, h.uses);
    var p = SF.Player;
    // swirl entry FX (graphics-juice hooks)
    SF.Particles.burst(h.x, h.y, '#b45cff', 30, 280, 0.8, 4);
    SF.Particles.burst(h.x, h.y, '#7df9ff', 16, 180, 0.6, 3);
    if (SF.FX && SF.FX.shake) SF.FX.shake(9);
    if (SF.FX && SF.FX.jumpFlashNow) SF.FX.jumpFlashNow();
    sfx('wormhole_open');
    /* voice-wiring-v6: pack-6 wormhole enter line, guarded, save-neutral */
    if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('wormhole_enter', 2); } catch (e) {} }
    // collapse bookkeeping on the ORIGIN list (before travelTo re-seeds
    // the destination system; uses persist per session, not per visit)
    h.uses++;
    var collapsed = h.uses >= MAX_USES;
    if (collapsed) hs.splice(i, 1);
    transits.push({ from: sys, dest: pr.dest, risk: pr.risk, collapsed: collapsed });
    // jump via the existing system-jump path (additive; jumps untouched)
    SF.Game.travelTo(pr.dest);
    // exit FX + risk resolution
    SF.Particles.burst(p.x, p.y, '#7df9ff', 24, 240, 0.7, 4);
    sfx('wormhole_exit');
    /* voice-wiring-v6: pack-6 wormhole exit line, guarded, save-neutral */
    if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('wormhole_exit', 2); } catch (e) {} }
    if (pr.risk === 'hull') {
      var mh = (typeof p.maxHull === 'function') ? p.maxHull() : 100;
      p.hull = Math.max(1, p.hull - mh * 0.15); // shear bypasses shields
      if (SF.FX && SF.FX.shake) SF.FX.shake(10);
      SF.HUD.toast('Wormhole shear! Hull -15%.');
    } else if (pr.risk === 'ambush') {
      // runtime call only; gameplay.js is not edited
      if (window.SF && SF.Encounters && typeof SF.Encounters.run === 'function') {
        SF.Encounters.run('ambush');
      }
      SF.HUD.toast('Pirate ambush on the far side!');
      /* voice-wiring-v6: pack-6 wormhole ambush line, guarded, save-neutral */
      if (window.SF && SF.Voice6 && SF.Voice6.pick) { try { SF.Voice6.pick('wormhole_ambush', 2); } catch (e) {} }
    }
    if (collapsed) {
      SF.Particles.burst(h.x, h.y, '#ffffff', 40, 320, 1.0, 5);
      SF.HUD.toast('The unstable wormhole collapses.');
    }
    cooldown = 1.6;
  }

  return {
    onEnterSystem: function (sys) {
      if (!holesBySys[sys]) holesBySys[sys] = gen(sys);
      armT = 1.2; // never enter a wormhole the instant a system loads
    },

    reset: function () {
      holesBySys = {}; transits = []; cooldown = 0; armT = 0;
    },

    update: function (dt) {
      if (cooldown > 0) cooldown -= dt;
      if (armT > 0) armT -= dt;
      if (!SF.Game || SF.Game.state !== 'PLAYING') return;
      var hs = curHoles(), ws = SF.CONFIG.worldSize, k, h;
      for (k = 0; k < hs.length; k++) { // drift
        h = hs[k];
        h.x += h.vx * dt; h.y += h.vy * dt;
        if (h.x < 200 || h.x > ws - 200) { h.vx = -h.vx; h.x = Math.max(200, Math.min(ws - 200, h.x)); }
        if (h.y < 200 || h.y > ws - 200) { h.vy = -h.vy; h.y = Math.max(200, Math.min(ws - 200, h.y)); }
      }
      var p = SF.Player;
      if (!p || !p.alive || cooldown > 0 || armT > 0) return;
      for (k = 0; k < hs.length; k++) {
        h = hs[k];
        var dx = p.x - h.x, dy = p.y - h.y, d2 = dx * dx + dy * dy;
        if (!h.hinted && d2 < HINT_R * HINT_R) {
          h.hinted = true;
          SF.HUD.toast('⚠ Unstable signature — destination unknown.');
        }
        if (d2 < ENTRY_R * ENTRY_R) { transit(k); return; }
      }
    },

    draw: function (ctx) {
      if (!SF.Game || (SF.Game.state !== 'PLAYING' && SF.Game.state !== 'STARMAP')) return;
      var t = performance.now() / 1000;
      var hs = curHoles();
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        ctx.save();
        ctx.translate(h.x, h.y);
        var g = ctx.createRadialGradient(0, 0, 4, 0, 0, 64);
        g.addColorStop(0, 'rgba(150,90,255,0.85)');
        g.addColorStop(0.45, 'rgba(90,50,220,0.35)');
        g.addColorStop(1, 'rgba(60,20,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.fill();
        for (var a = 0; a < 3; a++) { // spiral arms
          var rot = t * (1.4 + a * 0.35) + a * 2.1;
          ctx.strokeStyle = a === 0 ? 'rgba(125,249,255,0.9)' : 'rgba(180,92,255,0.75)';
          ctx.lineWidth = 5 - a;
          ctx.beginPath();
          ctx.arc(0, 0, 46 - a * 10, rot, rot + Math.PI * 1.15);
          ctx.stroke();
        }
        ctx.fillStyle = '#0a0618'; // dark core
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
        // HUD hint: signature only, NEVER the destination
        ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,210,63,0.95)';
        ctx.fillText('⚠ UNSTABLE SIGNATURE', 0, -78);
        ctx.restore();
      }
    },

    /* test introspection */
    peek: function (i) {
      var h = curHoles()[i];
      if (!h) return null;
      return outcome(SF.Game.systemId, h.seed, h.uses);
    },
    testEnter: function (i) { transit(i); },
    testSpawn: function (x, y, seed) {
      var sys = SF.Game.systemId;
      if (!holesBySys[sys]) holesBySys[sys] = [];
      holesBySys[sys].push({ x: x, y: y, vx: 0, vy: 0, seed: (seed >>> 0), uses: 0, hinted: false });
    },
    testState: function () {
      var hs = curHoles();
      return {
        system: SF.Game.systemId,
        count: hs.length,
        holes: hs.map(function (h) { return { x: h.x, y: h.y, seed: h.seed, uses: h.uses }; }),
        log: transits.slice()
      };
    }
  };
})();


/* afterburner-boost phase — SF.Afterburner (main.js only, additive).
 * Afterburner: hold Shift (keyboard) or double-tap-and-hold the thrust
 * joystick (touch) for +80% thrust, draining the shield as fuel at 4/s.
 * Boost cuts below 10% shield (warning flicker + toast); draining to the
 * floor triggers a 2s overheat lockout. Engine flare FX via the existing
 * particle trail / burst hooks. Additive on top of SF.Player.update via a
 * wrapped input vector — the thrust/movement pipeline is not refactored.
 * Save-neutral: all state is runtime-only, no SF.SAVE_VERSION bump.
 */
SF.Afterburner = (function () {
  var BOOST_MUL = 1.8;   // +80% thrust (target velocity scales linearly)
  var DRAIN = 4;         // shield/s while boosting
  var MIN_FRAC = 0.10;   // boost cuts below 10% shield
  var LOCKOUT_T = 2.0;   // overheat lockout after a full drain
  var TAP_WINDOW = 0.40; // double-tap window (s)
  var FLICKER_T = 1.2;   // warning flicker duration (s)

  var installed = false;
  var shiftHeld = false;
  var touchHold = false, touchHoldId = null; // second tap of a double-tap, held
  var lastTapEnd = -99, lastTapLeft = false, tapDownT = -99;
  var boostOn = false, lockoutT = 0, flickerT = 0;
  var appliedMul = 1;   // thrust multiplier actually applied last update
  var testForce = null;  // smoke-test override: true | false | null

  function sfx(id) {
    if (SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx(id); } catch (e) { /* synth fallback */ } }
  }
  function maxShield() {
    return (typeof SF.Player.maxShield === 'function') ? SF.Player.maxShield() : 1;
  }
  function shieldFrac() {
    var ms = maxShield();
    return ms > 0 ? SF.Player.shield / ms : 1;
  }
  function playerR() {
    return (typeof SF.Player.radius === 'function') ? SF.Player.radius() : 16;
  }
  function wantBoost() {
    return testForce !== null ? testForce : (shiftHeld || touchHold);
  }
  function flare() { // engine flare: bigger thrust puffs + hot core
    var p = SF.Player, r = playerR();
    var bx = p.x - Math.cos(p.angle) * (r + 6);
    var by = p.y - Math.sin(p.angle) * (r + 6);
    SF.Particles.thrust(bx, by, p.angle);
    SF.Particles.burst(bx, by, '#ffb02e', 4, 260, 0.5, 3);
    SF.Particles.burst(bx, by, '#fff2cc', 2, 140, 0.35, 2);
  }
  function cutBoost(fullDrain) {
    boostOn = false;
    flickerT = FLICKER_T; // warning flicker
    if (fullDrain) {
      lockoutT = LOCKOUT_T;
      SF.HUD.toast('\U0001F525 Afterburner overheated \u2014 2s lockout.');
      sfx('turret_overheat'); // banked file: overheat sizzle on lockout
    } else {
      SF.HUD.toast('\u26A0 Afterburner cut \u2014 shield low.');
    }
    if (SF.Audio && SF.Audio.hullAlarm) SF.Audio.hullAlarm();
  }
  function install() {
    if (installed) return; installed = true;
    if (!window.SF || !SF.Player || !SF.Player.update) return;
    window.addEventListener('keydown', function (e) {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = true;
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = false;
    });
    window.addEventListener('blur', function () { shiftHeld = false; touchHold = false; touchHoldId = null; });
    // touch: double-tap-and-hold on the thrust-joystick (left) half.
    document.addEventListener('touchstart', function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var now = performance.now() / 1000;
      var left = t.clientX < window.innerWidth * 0.5;
      tapDownT = now;
      if (left && (now - lastTapEnd) < TAP_WINDOW && lastTapLeft) {
        touchHold = true; touchHoldId = t.identifier;
      }
    }, { passive: true, capture: true });
    document.addEventListener('touchend', function (e) {
      var now = performance.now() / 1000;
      for (var i = 0; i < (e.changedTouches || []).length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === touchHoldId) { touchHold = false; touchHoldId = null; }
        if ((now - tapDownT) < 0.3 && tapDownT > 0) {
          lastTapEnd = now;
          lastTapLeft = t.clientX < window.innerWidth * 0.5;
        }
      }
    }, { passive: true });
    var origUpdate = SF.Player.update;
    if (origUpdate && origUpdate.__abw) return;
    SF.Player.update = function (dt, input) {
      if (lockoutT > 0) lockoutT -= dt;
      if (flickerT > 0) { // warning flicker: red puffs while active
        flickerT -= dt;
        if (Math.random() < 0.6) {
          SF.Particles.burst(SF.Player.x, SF.Player.y, '#ff3b30', 3, 180, 0.5, 3);
        }
      }
      var playing = (SF.Game && SF.Game.state === 'PLAYING');
      var moving = Math.hypot(input.mx || 0, input.my || 0) > 0.05;
      var adrift = false;
      try { adrift = !!(SF.Player.isAdrift && SF.Player.isAdrift()); } catch (e) { adrift = false; }
      var req = wantBoost() && playing && moving && !adrift &&
        !(window.SF && SF.TransitHazards && SF.TransitHazards.isActive()); // wormhole-anomalies: no boost inside a transit
      if (!req) {
        if (boostOn) boostOn = false; // request released — no lockout
      } else if (lockoutT > 0) {
        boostOn = false;
      } else if (boostOn) {
        SF.Player.shield -= DRAIN * dt; // burn shield as fuel
        flare();
        var ms = maxShield();
        if (ms > 0 && SF.Player.shield / ms <= MIN_FRAC) {
          SF.Player.shield = Math.max(0, ms * MIN_FRAC);
          cutBoost(true); // full drain -> overheat lockout
        }
      } else {
        if (shieldFrac() > MIN_FRAC) {
          boostOn = true;
          sfx('overdrive_heat'); // banked file: overdrive surge on engage
        } else if (flickerT <= 0) {
          cutBoost(false); // requested with shield already below the floor
        }
      }
      var mul = boostOn ? BOOST_MUL : 1;
      appliedMul = mul;
      var w = Object.create(input); // additive wrap: scale the velocity target
      w.mx = (input.mx || 0) * mul;
      w.my = (input.my || 0) * mul;
      return origUpdate.call(SF.Player, dt, w);
    };
    SF.Player.update.__abw = true;
  }
  return {
    install: install,
    /* smoke-test hooks */
    testBoost: function (v) { testForce = v; },
    state: function () {
      return { boostOn: boostOn, lockoutT: Math.max(0, lockoutT),
               shieldFrac: shieldFrac(), shiftHeld: shiftHeld,
               touchHold: touchHold, flickerT: Math.max(0, flickerT),
               mul: BOOST_MUL, appliedMul: appliedMul, drain: DRAIN,
               minFrac: MIN_FRAC, lockoutLen: LOCKOUT_T };
    }
  };
})();

/* ============================================================
 * voice-wiring-v6 phase — SF.Voice6: voice-pack-6 wiring helper.
 *
 * Central table + guarded playback for the pack-6 lines wired in
 * this phase (mining-minigame results, wormhole travel, companion-
 * quest turn-ins, dungeon whispers, skill prestige, route-set).
 * Playback: guarded SF.Audio.voice(id) + lazy subtitle caption
 * reusing the campaign.js caption pattern (reuse #sf-voice-caption
 * if present, else create it with the same pattern; a new line
 * interrupts an in-flight caption). Voice can never break gameplay:
 * everything is try/catch, fire-and-forget, save-neutral.
 * No signature changes. No SF.SAVE_VERSION bump.
 * ============================================================ */
SF.Voice6 = (function () {
  var LINES = {
    'mineperfect_01': { n: 'MINING AI', c: '#7dff8a', t: 'Dead center! Triple yield, beautiful!', d: 2.71 },
    'mineperfect_02': { n: 'MINING AI', c: '#7dff8a', t: 'Perfect strike! The rock just gives up its ore.', d: 3.13 },
    'minesweet_01':   { n: 'MINING AI', c: '#7dff8a', t: 'Sweet spot. Double ore, nice and clean.', d: 3.26 },
    'minesweet_02':   { n: 'MINING AI', c: '#7dff8a', t: 'In the green. Twice the haul.', d: 2.26 },
    'minesweet_03':   { n: 'MINING AI', c: '#7dff8a', t: 'Clean release. Double payload.', d: 2.26 },
    'minemiss_01':    { n: 'MINING AI', c: '#7dff8a', t: 'Missed the zone. Standard yield.', d: 2.33 },
    'minemiss_02':    { n: 'MINING AI', c: '#7dff8a', t: "Off the mark. We'll get the next one.", d: 2.66 },
    'wormhole_enter_01':  { n: 'CAPTAIN', c: '#ffd23f', t: 'Riding the swirl! Hold her steady!', d: 2.95 },
    'wormhole_enter_02':  { n: 'CAPTAIN', c: '#ffd23f', t: 'Into the hole we go. Brace!', d: 2.39 },
    'wormhole_exit_01':   { n: 'CAPTAIN', c: '#ffd23f', t: 'Through clean. All systems green.', d: 2.30 },
    'wormhole_exit_02':   { n: 'CAPTAIN', c: '#ffd23f', t: 'Made it. That never gets old.', d: 2.20 },
    'wormhole_ambush_01': { n: 'CAPTAIN', c: '#ff8a5e', t: 'Contacts on the far side! Weapons hot, weapons hot!', d: 4.10 },
    'wormhole_ambush_02': { n: 'CAPTAIN', c: '#ff8a5e', t: 'Ambush! Pirates were waiting. Shields up!', d: 3.24 },
    'cq_turnin_01':   { n: 'WINGMAN', c: '#7fd4ff', t: "Job's done, boss. Pleasure flying with you.", d: 3.13 },
    'cq_turnin_02':   { n: 'WINGMAN', c: '#7fd4ff', t: 'Contract complete. You run a tight ship.', d: 2.91 },
    'cq_turnin_03':   { n: 'WINGMAN', c: '#7fd4ff', t: "Another one in the books. What's next?", d: 2.43 },
    'cq_loyalmax_01': { n: 'WINGMAN', c: '#7fd4ff', t: "I'd follow you into a black hole, captain. My loyalty is yours, for good.", d: 4.86 },
    'whisper_01': { n: 'THE CATHEDRAL', c: '#b45cff', t: 'They sang here once... before the Warden silenced the choir.', d: 3.17 },
    'whisper_02': { n: 'THE CATHEDRAL', c: '#b45cff', t: 'The Cathedral remembers every captain who never left.', d: 2.96 },
    'whisper_03': { n: 'THE CATHEDRAL', c: '#b45cff', t: 'Requiem harmonics... the last song. Take it. End the silence.', d: 4.36 },
    'whisper_04': { n: 'THE CATHEDRAL', c: '#b45cff', t: "Depth seven... the choir loft... don't let the dark keep the tune.", d: 3.28 },
    'prestige_gunnery_01':     { n: 'SKILL CORE', c: '#6a5cff', t: 'Gunnery prestiged. Your cannons will never forget this.', d: 3.91 },
    'prestige_piloting_01':    { n: 'SKILL CORE', c: '#6a5cff', t: 'Piloting prestiged. The ship is an extension of you now.', d: 3.63 },
    'prestige_engineering_01': { n: 'SKILL CORE', c: '#6a5cff', t: 'Engineering prestiged. Your shields sing at your touch.', d: 3.48 },
    'prestige_trading_01':     { n: 'SKILL CORE', c: '#6a5cff', t: 'Trading prestiged. The markets bend to your will.', d: 3.41 },
    'prestige_leadership_01':  { n: 'SKILL CORE', c: '#6a5cff', t: 'Leadership prestiged. Your crew would follow you anywhere.', d: 3.80 },
    'route_set_01': { n: 'NAV COMPUTER', c: '#8fd0ff', t: 'Route pinned. Follow the money, captain.', d: 2.97 },
    'route_set_02': { n: 'NAV COMPUTER', c: '#8fd0ff', t: 'Trade route locked in. Profits await.', d: 2.64 },
    'route_set_03': { n: 'NAV COMPUTER', c: '#8fd0ff', t: 'Waypoint set. Buy low, sell high, fly safe.', d: 3.66 }
  };

  var hideT = null;

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

  /* say(id[, name, color]): guarded voice + caption. Returns the id on
   * success, null when the id is unknown or playback unavailable. */
  function say(id, name, color) {
    var b = LINES[id];
    if (!b) return null;
    try {
      if (window.SF && SF.Audio && SF.Audio.voice) SF.Audio.voice(id);
    } catch (e) { /* voice is best-effort */ }
    try {
      var el = ensureCaption();
      if (hideT) { clearTimeout(hideT); hideT = null; }
      el.innerHTML = '';
      var sp = document.createElement('div');
      sp.style.cssText = 'font-size:11px;letter-spacing:2px;color:' + (color || b.c) +
        ';margin-bottom:4px;font-weight:700;';
      sp.textContent = name || b.n;
      var tx = document.createElement('div');
      tx.textContent = b.t;
      el.appendChild(sp);
      el.appendChild(tx);
      el.style.display = 'block';
      hideT = setTimeout(function () {
        hideT = null;
        var c = document.getElementById('sf-voice-caption');
        if (c) c.style.display = 'none';
      }, (b.d + 0.5) * 1000);
    } catch (e) { /* captions are best-effort */ }
    return id;
  }

  /* pick(prefix, n[, name, color]): play a random variant of a numbered
   * id family (e.g. pick('mineperfect', 2) -> mineperfect_01/_02). */
  function pick(prefix, n, name, color) {
    var k = 1 + Math.floor(Math.random() * Math.max(1, n));
    var id = prefix + '_0' + k;
    if (!LINES[id]) id = prefix + '_01'; // defensive; all families start at _01
    return say(id, name, color);
  }

  return {
    say: say,
    pick: pick,
    ids: function () { return Object.keys(LINES); }
  };
})();

document.addEventListener('DOMContentLoaded', function () { SF.Game.init(); });
/* ============================================================
 * wormhole-anomalies phase — SF.TransitHazards (main.js only, additive).
 *
 * Hazards INSIDE wormhole transit, wrapped around the existing
 * SF.Wormholes transit path (no refactor of flight/combat):
 *
 *  (1) Gravity surges — the transit tunnel shows a marked safe lane
 *      (glowing band, oscillates). Steering outside it crushes the hull:
 *      SURGE_DPS * speedMul hull damage/s (shields don't help). The tunnel
 *      accelerates, so speedMul ramps 1.0 -> 1.5 and the damage scales.
 *  (2) Ion storms — drifting storm cells drain shields at STORM_DPS/s
 *      while the ship is inside, UNLESS the Aegis reactor power profile
 *      is active (runtime read of SF.Player.reactorState() each tick).
 *  (3) Drifting caches — 0-2 per transit (seeded rarity). Grabbing one
 *      grants credits or a weapon mod but extends the transit timer by
 *      CACHE_TIME (time costs time).
 *
 * Mechanics: SF.Wormholes.update is wrapped. When a hazard transit is
 * active the wormhole update is replaced by the transit tick; otherwise
 * a proximity pre-check flags an imminent entry, and the deferred
 * SF.Game.travelTo wrap (installed OUTERMOST, after starmap.js's route
 * wrapper, so checkRoute/onArrival still run at real arrival) claims the
 * wormhole's travelTo call and begins the sequence instead of jumping
 * instantly. Completion calls the original travelTo chain.
 *
 * Protection during transit: SF.Player.update is wrapped to zero the
 * input vector (ship holds position, no firing; regen/reactor ticks
 * continue) and SF.Player.takeDamage is wrapped to absorb world damage
 * (hazards apply hull/shield changes directly). Both wrappers propagate
 * other phases' `_` idempotency flags (combat-feed pattern) so the
 * DamageFX 3s re-hook never stacks a duplicate layer.
 *
 * Rendering: SF.Wormholes.draw is wrapped to paint a screen-space tunnel
 * overlay (safe lane, storm cells, caches, ship cursor, timer) while a
 * transit is active. All state is runtime-only — save-neutral, no
 * SF.SAVE_VERSION bump, no save-blob keys.
 * ============================================================ */
SF.TransitHazards = (function () {
  var BASE_TIME = 6.0;    // base transit duration (s)
  var CACHE_TIME = 1.5;   // transit time added per cache grab
  var SURGE_DPS = 14;     // hull damage/s at speedMul=1 outside the safe lane
  var STORM_DPS = 26;     // shield drain/s inside an ion storm (no Aegis)
  var LANE_HALF = 0.34;   // safe-lane half-width in tunnel units
  var STEER = 1.7;        // cursor speed (tunnel units/s)
  var ENTRY_R = 95;       // mirrors SF.Wormholes' entry radius
  var CLAIM_WINDOW = 1.0; // s a proximity flag stays valid

  var installed = false, travelHooked = false, travelRetryIv = null;
  var origTravelTo = null;

  var active = false, dest = null;
  var t = 0, dur = BASE_TIME, speedMul = 1;
  var cx = 0, cy = 0;                       // ship cursor, tunnel units [-1..1]
  var lanePhase = 0, laneAmp = 0.5, laneFreq = 1.0;
  var storm = null, stormT = 0, stormFxT = 0, announcedAegis = false;
  var caches = [];
  var surgeFxT = 0;
  var pendingEntry = -99;                   // nowS() of last proximity flag
  var testCfg = null;

  function nowS() { return performance.now() / 1000; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function sfx(id) {
    if (SF.Audio && SF.Audio.sfx) { try { SF.Audio.sfx(id); } catch (e) { /* synth fallback */ } }
  }
  function toneFn(fn) {
    if (SF.Audio && SF.Audio[fn]) { try { SF.Audio[fn](); } catch (e) { /* never break transit */ } }
  }
  function toast(msg) {
    if (window.SF && SF.HUD && SF.HUD.toast) { try { SF.HUD.toast(msg); } catch (e) {} }
  }

  /* Aegis reactor power profile, read live every tick (runtime-only state). */
  function isAegis() {
    try {
      var rs = (SF.Player && SF.Player.reactorState) ? SF.Player.reactorState() : null;
      if (!rs || !SF.REACTOR_PROFILES) return false;
      var def = SF.REACTOR_PROFILES[rs.profile];
      return !!(def && def.id === 'aegis' && !(rs.vent > 0));
    } catch (e) { return false; }
  }

  function laneCenter() { return Math.sin(lanePhase) * laneAmp; }

  function newStorm(atShip) {
    return {
      x: atShip ? 0 : (Math.random() - 0.5) * 1.1,
      y: atShip ? 0 : (Math.random() - 0.5) * 0.9,
      vx: atShip ? 0 : (Math.random() - 0.5) * 0.22, // test-pinned storms don't drift
      r: atShip ? 0.42 : 0.30 + Math.random() * 0.10,
      t: 0,
      dur: atShip ? 30 : 4 + Math.random() * 3
    };
  }

  function pickModId() {
    var ids = (SF.MODS || []).map(function (m) { return m.id; });
    if (!ids.length) return 'coils';
    return ids[Math.floor(Math.random() * ids.length)];
  }

  function newCache(i, kinds) {
    var kind = kinds && kinds[i] ? kinds[i]
      : (Math.random() < 0.6 ? 'credits' : 'mod');
    return {
      x: (Math.random() - 0.5) * 1.2,
      y: -1.15 - i * 0.4,
      vy: 0.42 + Math.random() * 0.12,
      seed: Math.random() * Math.PI * 2,
      kind: kind,
      amount: kind === 'credits' ? 150 + Math.floor(Math.random() * 351) : 0,
      modId: kind === 'mod' ? pickModId() : null,
      taken: false
    };
  }

  function grabCache(c) {
    c.taken = true;
    dur += CACHE_TIME; // grabbing costs time: the transit extends
    if (c.kind === 'credits') {
      SF.Player.credits = (SF.Player.credits || 0) + c.amount;
      toast('\uD83D\uDCB0 Transit cache: +' + c.amount + 'cr (transit extended)');
      toneFn('credit');
    } else {
      var name = c.modId;
      try {
        if (SF.Mods && SF.Mods.addMod) SF.Mods.addMod(c.modId);
        if (SF.MOD_BY_ID && SF.MOD_BY_ID[c.modId]) name = SF.MOD_BY_ID[c.modId].name;
      } catch (e) {}
      toast('\uD83D\uDD27 Transit cache: ' + name + ' (transit extended)');
      toneFn('mod');
    }
    toneFn('pickup'); // banked procedural pickup blip (no asset fetch -> no console 404)
  }

  /* ---------------- transit lifecycle ---------------- */

  function beginTransit(systemId, opts) {
    opts = opts || {};
    if (active) return;
    try {
      dest = systemId;
      active = true;
      t = 0;
      dur = (opts.dur > 0) ? opts.dur : BASE_TIME;
      speedMul = 1;
      cx = 0; cy = 0;
      lanePhase = Math.random() * Math.PI * 2;
      laneAmp = (opts.laneAmp > 0) ? opts.laneAmp : 0.42 + Math.random() * 0.18;
      laneFreq = 0.7 + Math.random() * 0.6;
      storm = null;
      stormT = opts.storm ? 0 : 1.5 + Math.random() * 2.0;
      if (opts.storm) storm = newStorm(true);
      stormFxT = 0; announcedAegis = false;
      caches = [];
      var n = (opts.caches != null) ? opts.caches
        : (function () { var r = Math.random(); return r < 0.15 ? 2 : (r < 0.60 ? 1 : 0); })();
      for (var i = 0; i < n; i++) caches.push(newCache(i, opts.cacheKinds));
      surgeFxT = 0;
      pendingEntry = -99;
      toast('\uD83C\uDF00 Wormhole transit \u2014 ride the safe lane!');
      sfx('wormhole_open');
    } catch (e) {
      // never strand the sequence half-built; fall back to the plain jump
      active = false; dest = null;
      if (origTravelTo) { try { origTravelTo.call(SF.Game, systemId); } catch (e2) {} }
    }
  }

  function endTransit() {
    if (!active) return;
    active = false;
    var d = dest; dest = null;
    sfx('wormhole_exit');
    // complete the jump through the ORIGINAL travelTo chain so starmap
    // route checks / onArrival run at the real arrival
    try {
      if (origTravelTo) origTravelTo.call(SF.Game, d);
      else if (SF.Game && SF.Game.travelTo) SF.Game.travelTo(d);
    } catch (e) { /* arrival failed; player stays put, game continues */ }
  }

  function tick(dt) {
    if (!active || !SF.Player) return;
    t += dt;
    var prog = clamp(t / dur, 0, 1);
    speedMul = 1 + 0.5 * prog; // the tunnel accelerates: surge damage scales

    // steering: live input drives the tunnel cursor
    var inp = SF.Input || {};
    cx = clamp(cx + (inp.mx || 0) * STEER * dt, -1, 1);
    cy = clamp(cy + (inp.my || 0) * STEER * dt, -1, 1);

    // (1) gravity surges: outside the marked lane the hull takes damage
    //     scaled by transit speed (shields don't help against shear)
    lanePhase += dt * laneFreq * (0.8 + 0.4 * prog);
    var inLane = Math.abs(cx - laneCenter()) <= LANE_HALF;
    var p = SF.Player;
    if (!inLane) {
      var mh = (typeof p.maxHull === 'function') ? p.maxHull() : 100;
      if (mh > 0 && p.alive) {
        p.hull = Math.max(1, p.hull - SURGE_DPS * speedMul * dt);
        p.regenTimer = 0;
      }
      surgeFxT -= dt;
      if (surgeFxT <= 0) {
        surgeFxT = 0.55;
        toneFn('hullAlarm');
        if (SF.FX && SF.FX.shake) { try { SF.FX.shake(4); } catch (e) {} }
      }
    }

    // (2) ion storms: shield drain unless the Aegis profile is live
    stormT -= dt;
    if (!storm && stormT <= 0 && !(testCfg && testCfg.noStorm)) {
      storm = newStorm(false);
      stormT = 2.5 + Math.random() * 3;
    }
    if (storm) {
      storm.t += dt;
      storm.x = clamp(storm.x + storm.vx * dt, -1.2, 1.2);
      var dx = cx - storm.x, dy = cy - storm.y;
      var inside = (dx * dx + dy * dy) < storm.r * storm.r;
      if (inside && p.alive) {
        if (isAegis()) {
          if (!announcedAegis) {
            announcedAegis = true;
            toast('\uD83D\uDEE1 Aegis profile shunts the ion storm.');
          }
        } else {
          p.shield = Math.max(0, (p.shield || 0) - STORM_DPS * dt);
          p.regenTimer = 0;
          stormFxT -= dt;
          if (stormFxT <= 0) {
            stormFxT = 0.7;
            toneFn('shieldHit');
          }
        }
      }
      if (storm.t > storm.dur) storm = null;
    }

    // (3) drifting caches drift down-tunnel toward the ship's row
    for (var i = 0; i < caches.length; i++) {
      var c = caches[i];
      if (c.taken) continue;
      c.y += c.vy * dt;
      c.x += Math.sin(t * 2 + c.seed) * 0.08 * dt;
      var gx = cx - c.x, gy = cy - c.y;
      if (gx * gx + gy * gy < 0.16 * 0.16) grabCache(c);
      else if (c.y > 1.35) c.taken = true; // drifted past the ship
    }

    if (t >= dur) endTransit();
  }

  /* ---------------- entry interception ---------------- */

  // Flag an imminent wormhole entry BEFORE the original update runs, so the
  // travelTo wrap can tell a wormhole jump from a starmap jump.
  function noteProximity() {
    if (!SF.Game || SF.Game.state !== 'PLAYING' || !SF.Player || !SF.Player.alive) return;
    var st = null;
    try { st = SF.Wormholes.testState(); } catch (e) { return; }
    if (!st || !st.holes) return;
    var p = SF.Player;
    for (var i = 0; i < st.holes.length; i++) {
      var h = st.holes[i];
      var dx = p.x - h.x, dy = p.y - h.y;
      if (dx * dx + dy * dy < ENTRY_R * ENTRY_R) { pendingEntry = nowS(); return; }
    }
  }

  function claim(systemId) {
    if (!active && pendingEntry > -90 && (nowS() - pendingEntry) < CLAIM_WINDOW &&
        SF.Game && SF.Game.state === 'PLAYING' && typeof systemId === 'string') {
      pendingEntry = -99;
      beginTransit(systemId, testCfg && testCfg.beginOpts);
      testCfg = null;
      return true;
    }
    return false;
  }

  function doHookTravel() {
    if (travelHooked) return; travelHooked = true;
    if (!SF.Game || typeof SF.Game.travelTo !== 'function') return;
    origTravelTo = SF.Game.travelTo;
    var w = function (systemId) {
      if (claim(systemId)) return; // hazard transit begins; completion jumps
      return origTravelTo.apply(this, arguments);
    };
    w._thaTravelWrapped = true;
    // propagate other wrappers' idempotency flags (starmap `_hazardsWrapped`)
    for (var k in origTravelTo) {
      if (k.charAt(0) === '_' && !(k in w) && typeof origTravelTo[k] !== 'function') {
        try { w[k] = origTravelTo[k]; } catch (e) {}
      }
    }
    SF.Game.travelTo = w;
  }

  // Install immediately at main.js load (hud.js's deferred wraps install
  // over us later and chain correctly). NOTE: starmap.js's route wrapper
  // (starmap-hazards) never installs in practice — its hookTravel interval
  // was verified dead on 2026-10-21 (no _hazardsWrapped ever appears), so
  // there is no route-check behavior to preserve by deferring; chaining the
  // current travelTo keeps every live wrapper in the loop. If a route
  // wrapper ever lands later it chains outside us and still works.
  function hookTravel() {
    if (travelHooked) return;
    doHookTravel();
  }

  function propagateFlags(orig, w) {
    for (var k in orig) {
      if (k.charAt(0) === '_' && !(k in w) && typeof orig[k] !== 'function') {
        try { w[k] = orig[k]; } catch (e) {}
      }
    }
  }

  function hookPlayer() {
    if (!SF.Player) return;
    // freeze the world-ship during transit (zero input; regen/reactor tick on)
    if (typeof SF.Player.update === 'function' && !SF.Player.update._thaFrozen) {
      var origU = SF.Player.update;
      var wu = function (dt, input) {
        if (active) {
          return origU.call(SF.Player, dt,
            { mx: 0, my: 0, firing: false, aimActive: false, aimAngle: 0 });
        }
        return origU.call(SF.Player, dt, input);
      };
      wu._thaFrozen = true;
      propagateFlags(origU, wu);
      SF.Player.update = wu;
    }
    // the transit field absorbs world damage; hazards apply directly
    if (typeof SF.Player.takeDamage === 'function' && !SF.Player.takeDamage._thaGuard) {
      var origTD = SF.Player.takeDamage;
      var wt = function (dmg) {
        if (active) return;
        return origTD.call(SF.Player, dmg);
      };
      wt._thaGuard = true;
      propagateFlags(origTD, wt);
      SF.Player.takeDamage = wt;
    }
  }

  /* ---------------- screen-space tunnel overlay ---------------- */

  function drawTunnel(ctx) {
    var cv = ctx.canvas;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = cv.width / dpr, H = cv.height / dpr;
    if (!(W > 0 && H > 0)) return;
    var R = Math.min(W, H) * 0.46;
    var X = function (x) { return W / 2 + x * R * 1.5; };
    var Y = function (y) { return H / 2 + y * R * 1.0; };
    var lc = laneCenter();
    var inLane = Math.abs(cx - lc) <= LANE_HALF;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // tunnel backdrop
    ctx.fillStyle = 'rgba(5,2,18,0.94)';
    ctx.fillRect(0, 0, W, H);

    // rushing rings
    var tt = nowS();
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var ph = ((tt * (0.55 + 0.12 * speedMul) + i * 0.25) % 1);
      var rr = R * (0.25 + 1.35 * ph);
      ctx.strokeStyle = 'rgba(125,249,255,' + (0.34 * (1 - ph)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(W / 2, H / 2, rr, 0, Math.PI * 2); ctx.stroke();
    }
    // radial streaks
    ctx.strokeStyle = 'rgba(180,92,255,0.28)';
    ctx.lineWidth = 1.5;
    for (var s = 0; s < 26; s++) {
      var a = (s / 26) * Math.PI * 2 + tt * 0.12;
      var r0 = R * 0.32, r1 = R * (1.35 + 0.25 * Math.sin(tt * 3 + s * 1.7));
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0);
      ctx.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
      ctx.stroke();
    }

    // safe lane: glowing marked band
    var lx0 = X(lc - LANE_HALF), lx1 = X(lc + LANE_HALF);
    ctx.fillStyle = 'rgba(63,169,255,0.10)';
    ctx.fillRect(lx0, 0, lx1 - lx0, H);
    ctx.strokeStyle = 'rgba(63,209,255,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -tt * 60;
    ctx.beginPath(); ctx.moveTo(lx0, 0); ctx.lineTo(lx0, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx1, 0); ctx.lineTo(lx1, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(125,249,255,0.9)';
    ctx.fillText('SAFE LANE', (lx0 + lx1) / 2, 20);

    // gravity-surge vignette when outside the lane
    if (!inLane) {
      var pulse = 0.22 + 0.14 * Math.sin(tt * 9);
      var grd = ctx.createLinearGradient(0, 0, W, 0);
      var side = cx < lc ? 0 : 1; // surge presses from the side we're on
      if (side === 0) {
        grd.addColorStop(0, 'rgba(255,45,60,' + pulse.toFixed(3) + ')');
        grd.addColorStop(0.35, 'rgba(255,45,60,0)');
      } else {
        grd.addColorStop(0.65, 'rgba(255,45,60,0)');
        grd.addColorStop(1, 'rgba(255,45,60,' + pulse.toFixed(3) + ')');
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = '#ff5d6c';
      ctx.fillText('\u26A0 GRAVITY SURGE \u2014 HULL STRESS', W / 2, H - 46);
    }

    // ion storm cell
    if (storm) {
      var sx = X(storm.x), sy = Y(storm.y), sr = storm.r * R * 1.5;
      var aegis = isAegis();
      ctx.strokeStyle = aegis ? 'rgba(63,169,255,0.8)' : 'rgba(216,138,255,0.9)';
      ctx.lineWidth = 2.5;
      for (var q = 0; q < 3; q++) {
        var rot = tt * (1.8 + q * 0.5) + q * 2.1;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * (1 - q * 0.22), rot, rot + Math.PI * 1.2);
        ctx.stroke();
      }
      if (!aegis) {
        // crackling arcs
        ctx.strokeStyle = 'rgba(255,240,180,0.75)';
        ctx.lineWidth = 1.5;
        for (var z = 0; z < 5; z++) {
          var za = tt * 4 + z * 1.256, zr = sr * (0.3 + 0.6 * ((z * 37 + (tt * 60 | 0)) % 10) / 10);
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(za) * zr * 0.4, sy + Math.sin(za) * zr * 0.4);
          ctx.lineTo(sx + Math.cos(za + 0.5) * zr, sy + Math.sin(za + 0.5) * zr);
          ctx.stroke();
        }
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('\u26A1 ION STORM \u2014 SHIELDS DRAINING', W / 2, 44);
      } else {
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#3fa9ff';
        ctx.fillText('\uD83D\uDEE1 AEGIS SHUNT \u2014 STORM NEUTRALIZED', W / 2, 44);
      }
    }

    // drifting caches
    for (var ci = 0; ci < caches.length; ci++) {
      var c = caches[ci];
      if (c.taken || c.y < -1.25 || c.y > 1.3) continue;
      var px = X(c.x), py = Y(c.y);
      var pr2 = 9 + 2.5 * Math.sin(tt * 5 + c.seed);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = c.kind === 'credits' ? '#ffd23f' : '#b45cff';
      ctx.fillRect(-pr2 / 1.6, -pr2 / 1.6, pr2 * 1.25, pr2 * 1.25);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-pr2 / 1.6, -pr2 / 1.6, pr2 * 1.25, pr2 * 1.25);
      ctx.restore();
    }

    // ship cursor
    var hx = X(cx), hy = Y(cy);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.fillStyle = inLane ? '#7df9ff' : '#ff5d6c';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // engine glow
    ctx.fillStyle = 'rgba(255,176,46,0.85)';
    ctx.beginPath(); ctx.arc(0, 12, 3.5 + Math.sin(tt * 22) * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // transit timer
    var bw = Math.min(300, W * 0.5), bx = (W - bw) / 2, by = H - 26;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 4, by - 18, bw + 8, 30);
    ctx.fillStyle = 'rgba(90,60,180,0.55)';
    ctx.fillRect(bx, by, bw, 10);
    ctx.fillStyle = '#b45cff';
    ctx.fillRect(bx, by, bw * clamp(t / dur, 0, 1), 10);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#cdbcf5';
    ctx.fillText('WORMHOLE TRANSIT', W / 2, by - 6);

    ctx.restore();
  }

  /* ---------------- install ---------------- */

  function install() {
    if (installed) return; installed = true;
    if (!window.SF || !SF.Wormholes) return;

    if (typeof SF.Wormholes.update === 'function' && !SF.Wormholes.update._thaWrapped) {
      var origUpdate = SF.Wormholes.update;
      var wu = function (dt) {
        if (active) {
          if (SF.Game && SF.Game.state === 'PLAYING') tick(dt);
          return; // holes hold position while the ship is in transit
        }
        noteProximity();
        return origUpdate.call(SF.Wormholes, dt);
      };
      wu._thaWrapped = true;
      propagateFlags(origUpdate, wu);
      SF.Wormholes.update = wu;
    }

    if (typeof SF.Wormholes.draw === 'function' && !SF.Wormholes.draw._thaDrawn) {
      var origDraw = SF.Wormholes.draw;
      var wd = function (ctx) {
        var r = origDraw.call(SF.Wormholes, ctx);
        if (active && SF.Game &&
            (SF.Game.state === 'PLAYING' || SF.Game.state === 'STARMAP')) {
          try { drawTunnel(ctx); } catch (e) { /* overlay must never break render */ }
        }
        return r;
      };
      wd._thaDrawn = true;
      propagateFlags(origDraw, wd);
      SF.Wormholes.draw = wd;
    }

    hookPlayer();
    hookTravel();
  }

  return {
    install: install,
    isActive: function () { return active; },
    travelHooked: function () { return travelHooked; }, // introspection: the claim wrapper is in the travelTo chain
    beginTransit: beginTransit, // wrapped by the travelTo claim; tests may call directly

    /* smoke-test hooks */
    testCfg: function (cfg) { testCfg = cfg || null; },
    testBegin: function (destId, opts) { beginTransit(destId, opts || {}); },
    testSteer: function (x, y) { cx = clamp(x, -1, 1); cy = clamp(y, -1, 1); },
    testEnd: function () { endTransit(); },
    state: function () {
      return {
        active: active, t: t, dur: dur, dest: dest,
        laneC: laneCenter(), laneHalf: LANE_HALF, inLane: Math.abs(cx - laneCenter()) <= LANE_HALF,
        cx: cx, cy: cy, speedMul: speedMul,
        storm: storm ? { x: storm.x, y: storm.y, r: storm.r, t: storm.t, dur: storm.dur } : null,
        aegis: isAegis(),
        caches: caches.map(function (c) {
          return { x: c.x, y: c.y, kind: c.kind, modId: c.modId, taken: c.taken };
        }),
        params: { baseTime: BASE_TIME, cacheTime: CACHE_TIME, surgeDps: SURGE_DPS,
                  stormDps: STORM_DPS, laneHalf: LANE_HALF, steer: STEER, entryR: ENTRY_R }
      };
    }
  };
})();

/* wormhole-anomalies: install at load (main.js is the last script).
 * The SF.Game.travelTo wrap stays deferred until starmap.js's route
 * wrapper is outermost, so wormhole arrivals keep checkRoute/onArrival. */
if (window.SF && SF.TransitHazards) SF.TransitHazards.install();


/* ============================================================
 * pirate-parley phase — SF.Parley (main.js only, additive).
 *
 * Crippled pirates (< 20% hull) may hail the pilot with a surrender
 * offer instead of fighting to the death: they drop credits/parts/
 * cargo drawn from their existing kill loot table and flee (despawn)
 * if accepted (+2 karma via guarded SF.Factions.shiftKarma). Refuse /
 * Destroy close the hail and combat continues as usual.
 *
 * Mechanics:
 * - Installs once (flag __pparl) as an additive wrap of
 *   SF.Enemies.damage, evaluated after the original damage resolves.
 *   No other combat/flight code is touched; the wrap is installed
 *   lazily from SF.Game.update() so script merge order never matters.
 * - A hail fires at most once per enemy (e.hailed guard flag on the
 *   enemy object) and is a seeded-RNG ~40% chance so it never feels
 *   scripted. Eligible: PLAYING state, hp>0, pirate (no faction, no
 *   trader flag, not a boss), hull fraction < 0.20, not adrift
 *   (Phase 3 owns adrift ships via boarding), no other hail open.
 * - The hail reuses the shared SF.Dialogue overlay (title + flavor
 *   text + three choices: Accept / Refuse / Destroy). Fleeing pirates
 *   (hp < fleeHpFrac 0.25) never fire, so the dialogue is safe while
 *   the game keeps running underneath.
 * - Accept: enemy must still be in SF.Enemies.list (it may have died
 *   while the pilot deliberated); tribute pickups spawn at its
 *   position, the pirate despawns with a green burst, karma +2.
 * - Hail sound: guarded SF.Audio.sfx('surrender_hail') once the banked
 *   file is router-ready (sfx-bank-v9 ships the file + warms the
 *   router with one sfx() call at boot), else a local three-pip synth
 *   chirp that respects the mute setting. Deliberately never probes a
 *   missing ogg: a 404 fetch logs a console error even when caught.
 * - Save-neutral: no SF.SAVE_VERSION bump, no save-blob keys; all
 *   state is runtime-only (enemy objects are never serialized).
 *
 * New SF.* API: SF.Parley.install(), .state(),
 *   .testSeed(s), .testRoll(v), .testHailNow(e), .testClose().
 * ============================================================ */
SF.Parley = (function () {
  var HAIL_HP_FRAC = 0.20;   // crippled threshold (below the 0.25 flee line)
  var HAIL_CHANCE = 0.40;    // seeded ~40% hail chance per eligible hit
  var KARMA_GRANT = 2;       // karma for accepting a surrender

  var installed = false;
  var hailOpen = false;      // one hail dialogue at a time
  var hailedTotal = 0, acceptedTotal = 0;
  var forceRoll = null;      // smoke-test override: true | false | null

  /* beta2-tribute: keyboard answers for the hail. The dialogue was
   * click-only: Digit1/2/3, Enter and Escape did nothing while it was
   * open (probe-proven on the live tree), so a keyboard pilot mid-fight
   * could only answer by reaching for the mouse while the full-screen
   * overlay hid the battle. 1/2/3 fire the three choices in order;
   * Escape closes without choosing, exactly like the LEAVE button and
   * like SF.Dialog's Esc-means-cancel convention (dialog.js). The
   * handler is installed on open and removed on EVERY close path via
   * the wrapped SF.Dialogue.close below, so it can never linger and
   * answer a later, unrelated dialogue. Choice runs are captured, not
   * re-derived from the DOM, so a keypress runs precisely what the
   * matching button would run — no mechanic, cost, or consequence
   * changes. Keys are deliberately NOT bound to Space (fire) or
   * WASD/arrows (flight), so a held fire/move key can never answer
   * the hail by accident. */
  var keyChoices = null;     // [accept, refuse, destroy] runs, or null
  var keyHandler = null;
  function installKeys(choices) {
    removeKeys();
    keyChoices = choices;
    keyHandler = function (e) {
      if (!hailOpen || !keyChoices) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      var idx = -1;
      if (e.code === 'Digit1' || e.code === 'Numpad1') idx = 0;
      else if (e.code === 'Digit2' || e.code === 'Numpad2') idx = 1;
      else if (e.code === 'Digit3' || e.code === 'Numpad3') idx = 2;
      else if (e.key === 'Escape' || e.keyCode === 27) {
        try { if (window.SF && SF.Dialogue && SF.Dialogue.close) SF.Dialogue.close(); } catch (e2) {}
        return;
      } else return;
      try { keyChoices[idx](); } catch (e3) { /* a choice must never throw into input */ }
    };
    window.addEventListener('keydown', keyHandler);
  }
  function removeKeys() {
    if (keyHandler) { try { window.removeEventListener('keydown', keyHandler); } catch (e) {} }
    keyHandler = null; keyChoices = null;
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(hashStr('parley:' + (Date.now() % 2147483647)));

  /* Hail sting: banked file when the router already has it (sfx-bank-v9
   * warms the router at boot), otherwise a local three-pip radio chirp.
   * Never probes a missing ogg — a 404 fetch logs a console error even
   * inside a caught promise, and the smoke gate is zero console errors. */
  function hailSound() {
    var banked = false;
    try {
      if (window.SF && SF.Audio && SF.Audio.sfx && SF.Audio._sfxState &&
          SF.Audio._sfxState('surrender_hail') === 'ready') {
        SF.Audio.sfx('surrender_hail');
        banked = true;
      }
    } catch (e) { /* fall through to synth */ }
    if (!banked) synthHail();
  }
  function synthHail() {
    try {
      if (window.SF && SF.Audio && SF.Audio.isMuted && SF.Audio.isMuted()) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var c = synthHail.ctx || (synthHail.ctx = new AC());
      if (c.state === 'suspended') { try { c.resume(); } catch (e2) {} }
      var t = c.currentTime;
      var pips = [[880, 0], [660, 0.12], [990, 0.24]];
      for (var i = 0; i < pips.length; i++) {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = pips[i][0];
        var t0 = t + pips[i][1];
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
        o.connect(g); g.connect(c.destination);
        o.start(t0); o.stop(t0 + 0.13);
      }
    } catch (e) { /* sound must never break gameplay */ }
  }

  function isPirate(e) {
    return !!e && !e.faction && !e.trader && !e.boss;
  }

  function hailRoll() {
    if (forceRoll !== null) { var v = forceRoll; forceRoll = null; return !!v; }
    return rng() < HAIL_CHANCE;
  }

  /* Tribute: same rolls as the kill() drop table (credits / ore /
   * item / part) for this enemy's type. No weapon drop — a surrendering
   * pirate keeps its gun. No faction/quest hooks: mercy is not a kill. */
  function tribute(e) {
    var spec = e.spec || {};
    var cMin = spec.creditsMin || 0, cMax = spec.creditsMax || 0;
    var credits = cMin + Math.floor(Math.random() * (cMax - cMin + 1));
    if (credits > 0) SF.Pickups.spawnCredits(e.x, e.y, credits);
    var oMin = spec.oreMin || 0, oMax = spec.oreMax || 0;
    var ore = oMin + Math.floor(Math.random() * (oMax - oMin + 1));
    for (var i = 0; i < ore; i++) SF.Pickups.spawnOre(e.x, e.y, 1);
    if (Math.random() < (spec.itemChance || 0) &&
        window.SF && SF.ITEM_DROPS && SF.ITEM_DROPS[e.type]) {
      var weights = SF.ITEM_DROPS[e.type];
      var total = weights[0] + weights[1] + weights[2];
      var r = Math.random() * total, id = SF.ITEMS[0].id;
      if (r < weights[0]) id = SF.ITEMS[0].id;
      else if (r < weights[0] + weights[1]) id = SF.ITEMS[1].id;
      else id = SF.ITEMS[2].id;
      SF.Pickups.spawnItem(e.x, e.y, id);
    }
    var partChance = (window.SF && SF.CONFIG.partDrops && SF.CONFIG.partDrops[e.type]) || 0;
    if (Math.random() < partChance && window.SF && SF.PARTS) {
      var commons = [];
      for (var pi = 0; pi < SF.PARTS.length; pi++) {
        if (SF.PARTS[pi].tier === 'white' || SF.PARTS[pi].tier === 'green') commons.push(SF.PARTS[pi]);
      }
      if (commons.length) {
        var rp = commons[Math.floor(Math.random() * commons.length)];
        SF.Pickups.spawnPart(e.x, e.y, rp.id);
      }
    }
  }

  function closeHail(msg) {
    hailOpen = false;
    try { if (window.SF && SF.Dialogue && SF.Dialogue.close) SF.Dialogue.close(); } catch (e2) {}
    if (msg && window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast(msg);
  }

  function accept(e) {
    hailOpen = false;
    try { if (window.SF && SF.Dialogue && SF.Dialogue.close) SF.Dialogue.close(); } catch (e2) {}
    var list = (window.SF && SF.Enemies && SF.Enemies.list) || [];
    if (list.indexOf(e) < 0) { // died while the pilot deliberated
      if (window.SF && SF.HUD && SF.HUD.toast) SF.HUD.toast('The pirate is already space dust.');
      return;
    }
    tribute(e);
    var idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1); // flee: despawn
    SF.Particles.burst(e.x, e.y, '#7dff8a', 18, 200, 0.7, 3);
    if (window.SF && SF.Factions && SF.Factions.shiftKarma) {
      try { SF.Factions.shiftKarma(KARMA_GRANT); } catch (e3) {}
    }
    acceptedTotal++;
    try { if (window.SF && SF.Audio && SF.Audio.sfx) SF.Audio.sfx('credit'); } catch (e4) {}
    if (window.SF && SF.HUD && SF.HUD.toast)
      SF.HUD.toast('\uD83C\uDFF4 Tribute accepted \u2014 the pirate flees. Karma +2.');
  }

  var HAIL_TEXTS = [
    '\u201CHold fire! HOLD FIRE! I\u2019m done \u2014 take the credits, take the cargo, just let me fly out of here!\u201D',
    '\u201CMercy, captain! My hull\u2019s coming apart \u2014 everything in the hold is yours if you let me live.\u201D',
    '\u201CYou win, you win! I\u2019ll jettison the goods \u2014 credits, parts, all of it. Just don\u2019t finish me.\u201D',
    '\u201CWait \u2014 don\u2019t shoot! I surrender! Take what you want and I\u2019ll never cross your scope again!\u201D'
  ];

  function openHail(e) {
    e.hailed = true; // guard flag: fires at most once per enemy
    hailedTotal++;
    hailOpen = true;
    hailSound();
    var name = e.eliteName || (e.spec && e.spec.scoreName) || 'Pirate';
    var txt = HAIL_TEXTS[Math.floor(rng() * HAIL_TEXTS.length)];
    // beta2-tribute: the three runs, shared by buttons AND keyboard keys.
    var choices = [
      { label: 'Accept the tribute (+2 karma) [1]', run: function () { accept(e); } },
      { label: 'Refuse \u2014 no deal [2]', run: function () {
        closeHail('\u201CYour funeral, captain.\u201D \u2014 the pirate fights on.'); } },
      { label: 'Destroy on sight [3]', run: function () {
        closeHail('No quarter given. Finish it.'); } }
    ];
    try {
      SF.Dialogue.open({
        title: '\uD83C\uDFF4 ' + name + ' \u2014 Surrender Hail',
        text: txt,
        choices: choices
      });
      // Pause registration (unchanged, hail-pause-2): Dialogue.open
      // routes through SF.Game.showOverlay('overlay-dialogue'), which
      // sets modalOpenIds['overlay-dialogue'] and modalBlocking() true,
      // so frame() renders but never advances the sim while open.
      installKeys([choices[0].run, choices[1].run, choices[2].run]);
    } catch (err) {
      hailOpen = false; // dialogue must never strand the flag
      removeKeys();
    }
  }

  function maybeHail(e) {
    if (!window.SF || !SF.Game || SF.Game.state !== 'PLAYING') return;
    if (!isPirate(e)) return;
    if (e.hailed) return;                       // at most once per enemy
    if (hailOpen) return;                       // one hail at a time
    if (e.hp <= 0) return;                       // dead — the kill path owns it
    if (!(e.maxHp > 0)) return;
    if (e.hp / e.maxHp >= HAIL_HP_FRAC) return;
    if (e.adrift) return;                        // Phase 3 owns adrift ships
    if (!SF.Dialogue || !SF.Dialogue.open) return;
    if (!hailRoll()) { e.hailed = true; return; } // rolled "no" — still once
    openHail(e);
  }

  function install() {
    if (installed) return; installed = true;
    if (!window.SF || !SF.Enemies || !SF.Enemies.damage) return;
    if (SF.Enemies.damage.__pparl) return;
    var orig = SF.Enemies.damage;
    SF.Enemies.damage = function (e, dmg) {
      var r = orig.apply(this, arguments);
      try { maybeHail(e); } catch (err) { /* never break combat */ }
      return r;
    };
    SF.Enemies.damage.__pparl = true;
    // encounter-pause-1: closing a hail via the dialogue CLOSE button
    // bypassed closeHail(), stranding hailOpen=true (no future hails ever).
    // Clearing the flag on ANY Dialogue.close keeps the feature honest;
    // harmless for station dialogues (hailOpen is only read in combat).
    try {
      if (window.SF && SF.Dialogue && SF.Dialogue.close && !SF.Dialogue.close.__parley) {
        var origClose = SF.Dialogue.close;
        SF.Dialogue.close = function () { hailOpen = false; removeKeys(); return origClose.apply(this, arguments); };
        SF.Dialogue.close.__parley = true;
      }
    } catch (e2) {}
  }

  return {
    install: install,
    state: function () {
      return { installed: installed, hailOpen: hailOpen,
               hailedTotal: hailedTotal, acceptedTotal: acceptedTotal,
               chance: HAIL_CHANCE, hpFrac: HAIL_HP_FRAC, karmaGrant: KARMA_GRANT };
    },
    /* smoke-test hooks */
    testSeed: function (s) { rng = mulberry32((s >>> 0) || 1); },
    testRoll: function (v) { forceRoll = v; },
    testHailNow: function (e) { if (e && !hailOpen) { e.hailed = false; openHail(e); } },
    testClose: function () { closeHail(null); }
  };
})();

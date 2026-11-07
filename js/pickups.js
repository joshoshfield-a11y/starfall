/* STARFALL Phase 1 — pickups.js
 * Pooled pickups: credits, ore, item components. Magnet-tractor toward player.
 */
window.SF = window.SF || {};

SF.Pickups = (function () {
  var POOL = 128;
  var pool = [];

  function make() {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, kind: 'ore',
             amount: 1, itemId: null, tier: 'white', life: 0 };
  }

  function get() {
    for (var i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
    return null;
  }

  function toss(p, x, y) {
    p.active = true; p.x = x; p.y = y;
    var a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 90;
    p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
    p.life = SF.CONFIG.pickup.life;
  }

  /* ---- v2-fx-wiring: file-backed pickup icons ----
   * Sprite-first via SF.Sprites (fx/powerups + fx/collectibles icons).
   * A tier-coloured ring + dark backing disc stay procedural (they carry
   * the tier readability); a null from the loader keeps the original
   * glyph draw below, so a missing icon never blanks a pickup.
   * Mapping is semantic: credits -> coin stack, ore -> crystal cluster,
   * weapons/mods -> weapon icon (overclock-type mods -> speed), ship
   * parts by SF.PARTS type, components -> data-core / fuel / relic. */
  var PICKUP_SPRITE_IDS = {
    'fx/powerups': ['weapon', 'shield', 'speed', 'repair'],
    'fx/collectibles': ['credits', 'cargo-crate', 'data-core', 'fuel', 'relic', 'ammo'],
    'fx/misc': ['crystal-cluster']
  };
  var pickupPreloaded = false;

  function preloadPickupSprites() {
    if (pickupPreloaded) return;
    pickupPreloaded = true;
    if (window.SF && SF.Sprites) {
      for (var k in PICKUP_SPRITE_IDS) {
        if (PICKUP_SPRITE_IDS.hasOwnProperty(k)) SF.Sprites.preload(k, PICKUP_SPRITE_IDS[k]);
      }
    }
  }

  function pickupSpriteFor(p) {
    if (!p) return null;
    switch (p.kind) {
      case 'credits': return 'fx/collectibles/credits';
      case 'ore': return 'fx/misc/crystal-cluster';
      case 'weapon': return 'fx/powerups/weapon';
      case 'mod':
        if (p.itemId === 'overclock' || p.itemId === 'smugglers_tuning') return 'fx/powerups/speed';
        if (p.itemId === 'coils') return 'fx/collectibles/ammo';
        return 'fx/powerups/weapon';
      case 'part': {
        var part = (window.SF && SF.PART_BY_ID) ? SF.PART_BY_ID[p.itemId] : null;
        var type = part ? part.type : '';
        if (type === 'shield') return 'fx/powerups/shield';
        if (type === 'engine') return 'fx/powerups/speed';
        if (type === 'cargo') return 'fx/collectibles/cargo-crate';
        if (type === 'reactor') return 'fx/collectibles/data-core';
        if (type === 'mount') return 'fx/powerups/weapon';
        return 'fx/powerups/repair';
      }
      case 'item':
        if (p.itemId === 'gravcore') return 'fx/collectibles/relic';
        if (p.itemId === 'plasmacoil') return 'fx/collectibles/fuel';
        return 'fx/collectibles/data-core';
      default:
        return 'fx/collectibles/cargo-crate';
    }
  }

  return {
    pool: pool,

    init: function () {
      pool.length = 0;
      for (var i = 0; i < POOL; i++) pool.push(make());
    },

    clear: function () {
      for (var i = 0; i < pool.length; i++) pool[i].active = false;
    },

    spawnCredits: function (x, y, amount) {
      var p = get(); if (!p) return;
      p.kind = 'credits'; p.amount = amount; p.itemId = null; p.tier = 'gold';
      toss(p, x, y);
    },

    spawnOre: function (x, y, amount) {
      var p = get(); if (!p) return;
      p.kind = 'ore'; p.amount = amount; p.itemId = null; p.tier = 'white';
      toss(p, x, y);
    },

    spawnItem: function (x, y, itemId) {
      var p = get(); if (!p) return;
      var item = SF.ITEM_BY_ID[itemId];
      p.kind = 'item'; p.amount = 1; p.itemId = itemId;
      p.tier = item ? item.tier : 'white';
      toss(p, x, y);
    },

    spawnPart: function (x, y, partId) {
      var p = get(); if (!p) return;
      var part = SF.PART_BY_ID[partId];
      p.kind = 'part'; p.amount = 1; p.itemId = partId;
      p.tier = part ? part.tier : 'white';
      toss(p, x, y);
    },

    /* weapons-arsenal: weapon + mod pickups */
    spawnWeapon: function (x, y, weaponId) {
      var p = get(); if (!p) return;
      var def = SF.WEAPON_BY_ID[weaponId];
      p.kind = 'weapon'; p.amount = 1; p.itemId = weaponId;
      p.tier = def ? def.tier : 'white';
      toss(p, x, y);
    },

    spawnMod: function (x, y, modId) {
      var p = get(); if (!p) return;
      var mod = SF.MOD_BY_ID[modId];
      p.kind = 'mod'; p.amount = 1; p.itemId = modId;
      p.tier = mod ? mod.tier : 'white';
      toss(p, x, y);
    },

    update: function (dt, player) {
      var cfg = SF.CONFIG.pickup;
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        var dx = player.x - p.x, dy = player.y - p.y;
        var d = Math.hypot(dx, dy);
        if (d < cfg.magnetRadius && d > 1) {
          var pull = 900 * (1 - d / cfg.magnetRadius) + 120;
          p.vx += dx / d * pull * dt; p.vy += dy / d * pull * dt;
        } else {
          p.vx *= (1 - Math.min(1, 1.6 * dt));
          p.vy *= (1 - Math.min(1, 1.6 * dt));
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (d < cfg.collectRadius) {
          p.active = false;
          if (p.kind === 'credits') {
            player.credits += p.amount;
            SF.Audio.credit();
            SF.Particles.burst(p.x, p.y, '#ffd23f', 6, 120, 0.4, 3);
          } else if (p.kind === 'ore') {
            // Phase 5: cargo enforced — full hold blocks ore pickup
            if (player.cargoUsed() >= player.cargoSpace()) {
              // open-space-1: no wall clamp — a full hold just nudges
              // the pickup aside wherever it is, even in deep space.
              p.x = p.x + (Math.random() - 0.5) * 120;
              p.y = p.y + (Math.random() - 0.5) * 120;
              p.active = true; // leave it drifting, don't collect
              if (!this._fullToast || performance.now() - this._fullToast > 4000) {
                this._fullToast = performance.now();
                SF.HUD.toast('📦 Cargo hold full!');
              }
              continue;
            }
            player.ore += p.amount;
            /* twelve-hour-wave3 (B2): the mining seam. This pickup IS the
             * mine event (asteroids break into ore chunks): it feeds the
             * mining-contract quest hook (which previously had NO call
             * site anywhere) and Skills mining XP (SF.Skills.onOre, whose
             * header documented the missing call site). Guarded: either
             * module missing = ore still collects, XP/quest just skip. */
            try { if (window.SF && SF.Quests && SF.Quests.onOreMined) SF.Quests.onOreMined(p.amount); } catch (e) {}
            try { if (window.SF && SF.Skills && SF.Skills.onOre) SF.Skills.onOre(p.amount); } catch (e) {}
            SF.Audio.pickup();
            SF.Particles.burst(p.x, p.y, '#c9c9c9', 6, 120, 0.4, 3);
          } else if (p.kind === 'weapon') {
            // weapons-arsenal: weapon pickups (duplicates convert to half-price credits)
            var wd = SF.WEAPON_BY_ID[p.itemId];
            if (!wd) { continue; }
            if (player.hasWeapon && player.hasWeapon(p.itemId)) {
              var half = Math.floor(wd.price / 2);
              player.credits += half;
              SF.Audio.credit();
              SF.HUD.toast('Duplicate ' + wd.name + ' → +' + half + 'c');
            } else {
              player.addWeapon(p.itemId);
              SF.Audio.pickup();
              SF.Particles.burst(p.x, p.y, SF.TIERS[p.tier] || '#fff', 12, 150, 0.5, 3);
              SF.HUD.toast('⚔ Weapon acquired: ' + wd.name);
            }
          } else if (p.kind === 'mod') {
            // weapons-arsenal: mod pickups (stack in inventory)
            var md = SF.MOD_BY_ID[p.itemId];
            if (!md) { continue; }
            if (SF.Mods) SF.Mods.addMod(p.itemId);
            SF.Audio.mod();
            SF.Particles.burst(p.x, p.y, md.color, 12, 150, 0.5, 3);
            SF.HUD.toast('⚙ Mod acquired: ' + md.name);
          } else if (p.kind === 'part') {
            player.addPart(p.itemId, 1);
            SF.Audio.pickup();
            var pc = SF.TIERS[p.tier] || '#fff';
            SF.Particles.burst(p.x, p.y, pc, 10, 150, 0.5, 3);
            SF.HUD.toast('Salvaged part: ' + SF.PART_BY_ID[p.itemId].name);
          } else {
            player.inventory[p.itemId] = (player.inventory[p.itemId] || 0) + 1;
            SF.Audio.pickup();
            var c = SF.TIERS[p.tier] || '#fff';
            SF.Particles.burst(p.x, p.y, c, 10, 150, 0.5, 3);
            SF.HUD.toast('Salvaged: ' + SF.ITEM_BY_ID[p.itemId].name);
          }
        }
      }
    },

    draw: function (ctx, time) {
      preloadPickupSprites();
      /* b-perf: view-cull pickups (icon 24px + tier ring 13px + bob).
       * Loot that drops offscreen stays simulated (it still drifts and
       * despawns on its timer); only its paint is skipped while it is
       * canvas-clipped. */
      var pkView = (window.SF && SF.FX && SF.FX.viewRect) ? SF.FX.viewRect(ctx) : null;
      var pkVis = (window.SF && SF.FX && SF.FX.rectVisible) ? SF.FX.rectVisible : null;
      var bob = Math.sin(time * 4) * 2;
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (!p.active) continue;
        if (pkVis && !pkVis(pkView, p.x, p.y, 18)) continue;
        if (p.life < 3 && Math.floor(time * 6) % 2 === 0) continue; // blink before despawn
        ctx.save();
        ctx.translate(p.x, p.y + bob);
        // v2-fx-wiring: sprite icon first (tier ring stays), glyph fallback on null
        var sprKey = pickupSpriteFor(p);
        var sprImg = null;
        if (sprKey && window.SF && SF.Sprites) {
          var sl = sprKey.lastIndexOf('/');
          sprImg = SF.Sprites.get(sprKey.slice(0, sl), sprKey.slice(sl + 1));
        }
        if (sprImg) {
          var tierC = SF.TIERS[p.tier] || '#fff';
          ctx.fillStyle = 'rgba(4,8,18,0.55)';
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = tierC; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
          ctx.drawImage(sprImg, -12, -12, 24, 24);
        } else if (p.kind === 'credits') {
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = '#ffd23f';
          ctx.fillRect(-4, -4, 8, 8);
        } else if (p.kind === 'ore') {
          ctx.fillStyle = '#b8b8c8';
          ctx.beginPath();
          ctx.moveTo(-5, 2); ctx.lineTo(-1, -5); ctx.lineTo(5, -1); ctx.lineTo(2, 5); ctx.lineTo(-4, 4);
          ctx.closePath(); ctx.fill();
        } else if (p.kind === 'part') {
          var pc2 = SF.TIERS[p.tier] || '#fff';
          ctx.fillStyle = pc2;
          ctx.beginPath();
          ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#04060f'; ctx.lineWidth = 1;
          ctx.stroke();
        } else if (p.kind === 'weapon') {
          // weapons-arsenal: weapon pickup — tier-colored crosshair box
          var wc = SF.TIERS[p.tier] || '#fff';
          ctx.strokeStyle = wc; ctx.lineWidth = 2.5;
          ctx.strokeRect(-6, -6, 12, 12);
          ctx.beginPath();
          ctx.moveTo(-3, 0); ctx.lineTo(3, 0);
          ctx.moveTo(0, -3); ctx.lineTo(0, 3);
          ctx.stroke();
        } else if (p.kind === 'mod') {
          // weapons-arsenal: mod pickup — tier-colored hex bolt
          var mc = SF.TIERS[p.tier] || '#fff';
          ctx.strokeStyle = mc; ctx.lineWidth = 2;
          ctx.beginPath();
          for (var hi = 0; hi < 6; hi++) {
            var ha = Math.PI / 3 * hi + Math.PI / 6;
            var hx = Math.cos(ha) * 7, hy = Math.sin(ha) * 7;
            if (hi === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
          }
          ctx.closePath(); ctx.stroke();
          ctx.fillStyle = mc;
          ctx.fillRect(-2, -2, 4, 4);
        } else {
          var c = SF.TIERS[p.tier] || '#fff';
          ctx.strokeStyle = c; ctx.lineWidth = 2;
          ctx.strokeRect(-5, -5, 10, 10);
          ctx.fillStyle = c;
          ctx.fillRect(-2, -2, 4, 4);
        }
        ctx.restore();
      }
    },

    /* v2-fx-wiring: icon mapping hook (smoke tests).
     * pickupSpriteFor({kind:'part', itemId:'ion_thruster'}) -> 'fx/powerups/speed'. */
    pickupSpriteFor: pickupSpriteFor,
    pickupSpriteIds: PICKUP_SPRITE_IDS
  };
})();

/* STARFALL weapons-arsenal phase — mods.js
 * SF.Mods: lootable weapon mods that multiply damage, fire rate and range.
 * 1 mod slot on white/green weapons, 2 on blue+. Mods stack multiplicatively.
 * Save v6 carries modsInv + mods[] on every weapon entry.
 */
window.SF = window.SF || {};

SF.Mods = (function () {

  function entrySlots(wid) {
    var def = SF.WEAPON_BY_ID[wid];
    return def ? (def.modSlots || 1) : 1;
  }

  /* Normalize an entry's mods array to its slot count (used on load/migrate). */
  function normalize(entry) {
    if (!entry) return entry;
    var n = entrySlots(entry.id);
    if (!Array.isArray(entry.mods)) entry.mods = [];
    while (entry.mods.length < n) entry.mods.push(null);
    entry.mods.length = n;
    return entry;
  }

  /* Combined multipliers across a weapon entry's fitted mods. */
  function mult(entry, key) {
    var m = 1;
    if (!entry || !entry.mods) return m;
    for (var i = 0; i < entry.mods.length; i++) {
      var mod = SF.MOD_BY_ID[entry.mods[i]];
      if (mod && mod.mul && mod.mul[key]) m *= mod.mul[key];
    }
    return m;
  }

  function inv() { return SF.Player.modsInv || {}; }

  /* b4-sprite-lighting: mod icons (m_<modId> maps 1:1 to all 5 mod ids)
   * via the SF.Sprites loader, same contract as station.js storeIcon. */
  function modIcon(modId) {
    var url = '';
    try {
      if (window.SF && SF.Sprites) {
        SF.Sprites.get('ui', 'icons/m_' + modId);
        url = SF.Sprites.urlFor('ui', 'icons/m_' + modId);
      }
    } catch (e) {}
    if (!url) url = 'assets/ui/icons/m_' + modId + '.png';
    return '<img class="store-icon" src="' + url + '" alt="" ' +
      'style="width:28px;height:28px;object-fit:contain;flex:none" ' +
      'onerror="this.style.display=\'none\'">';
  }

  return {
    normalize: normalize,

    damageMul: function (entry) { return mult(entry, 'dmg'); },
    rateMul:   function (entry) { return mult(entry, 'rate'); },
    rangeMul:  function (entry) { return mult(entry, 'range'); },

    /* DPS at current stars + mods (1-star starMult baseline), for store rows. */
    dps: function (wid, stars, entry) {
      var wcfg = SF.CONFIG.weapons[wid];
      if (!wcfg) return 0;
      var sm = SF.Upgrade ? SF.Upgrade.starMult(stars || 1) : 1;
      return wcfg.damage * sm * this.damageMul(entry) *
             (wcfg.fireRate * this.rateMul(entry)) * (wcfg.pellets || 1);
    },

    addMod: function (modId) {
      var p = SF.Player;
      p.modsInv = p.modsInv || {};
      p.modsInv[modId] = (p.modsInv[modId] || 0) + 1;
    },

    equip: function (wid, slot, modId) {
      var p = SF.Player;
      var entry = p.weaponEntry(wid);
      if (!entry) return false;
      normalize(entry);
      if (slot < 0 || slot >= entry.mods.length) return false;
      p.modsInv = p.modsInv || {};
      if ((p.modsInv[modId] || 0) <= 0) return false;
      // unequip whatever is there first
      var old = entry.mods[slot];
      if (old) p.modsInv[old] = (p.modsInv[old] || 0) + 1;
      entry.mods[slot] = modId;
      p.modsInv[modId]--;
      if (p.modsInv[modId] <= 0) delete p.modsInv[modId];
      if (SF.Audio && SF.Audio.mod) SF.Audio.mod();
      return true;
    },

    unequip: function (wid, slot) {
      var p = SF.Player;
      var entry = p.weaponEntry(wid);
      if (!entry || !entry.mods) return false;
      var old = entry.mods[slot];
      if (!old) return false;
      entry.mods[slot] = null;
      p.modsInv = p.modsInv || {};
      p.modsInv[old] = (p.modsInv[old] || 0) + 1;
      if (SF.Audio && SF.Audio.mod) SF.Audio.mod();
      return true;
    },

    /* ---- station UI: mods modal (child of overlay-store, so undock hides it) ---- */
    open: function (wid) {
      var entry = SF.Player.weaponEntry(wid);
      if (!entry) return;
      normalize(entry);
      var def = SF.WEAPON_BY_ID[wid];
      var modal = document.getElementById('mods-modal');
      if (!modal) return;
      var self = this;
      function refresh() { self.open(wid); }
      var html = '<h3>⚙ MODS — ' + def.name + '</h3>' +
        '<div class="dim" style="margin-bottom:6px">Damage ×' + this.damageMul(entry).toFixed(2) +
        ' · Rate ×' + this.rateMul(entry).toFixed(2) +
        ' · Range ×' + this.rangeMul(entry).toFixed(2) + '</div>';
      entry.mods.forEach(function (modId, slot) {
        var mod = modId ? SF.MOD_BY_ID[modId] : null;
        html += '<div class="mod-slot">' +
          (mod ? modIcon(modId) : '') +
          '<div><div class="store-name">Slot ' + (slot + 1) + '</div>' +
          '<div class="store-desc">' + (mod
            ? '<span style="color:' + mod.color + '">' + mod.name + '</span> — ' + mod.desc
            : 'empty') + '</div></div>' +
          (mod ? '<button class="btn store-btn" data-act="unequip" data-slot="' + slot + '">REMOVE</button>'
               : '<button class="btn store-btn" data-act="equip" data-slot="' + slot + '">FIT…</button>') +
          '</div>';
      });
      // inventory of unfitted mods
      var ids = Object.keys(inv()).filter(function (id) { return inv()[id] > 0; });
      html += '<div class="store-head">LOOTABLE MODS</div>';
      if (ids.length === 0) {
        html += '<div class="dim">No spare mods. Gunships carry the good ones.</div>';
      } else {
        ids.forEach(function (id) {
          var m = SF.MOD_BY_ID[id];
          html += '<div class="mod-slot">' + modIcon(id) + '<div><div class="store-name">' +
            '<span style="color:' + (m ? m.color : '#fff') + '">' + (m ? m.name : id) + '</span> ×' + inv()[id] +
            '</div><div class="store-desc">' + (m ? m.desc : '') + '</div></div></div>';
        });
      }
      html += '<button class="btn big ui-block" id="mods-close" style="margin-top:8px">CLOSE</button>';
      modal.innerHTML = html;
      modal.classList.remove('hidden');
      var picking = -1;
      modal.querySelectorAll('button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          var act = b.getAttribute('data-act');
          if (act === 'unequip') {
            if (self.unequip(wid, slot)) { SF.Save.save(); refresh(); }
          } else {
            // pick a mod from inventory
            var invIds = Object.keys(inv()).filter(function (id) { return inv()[id] > 0; });
            if (invIds.length === 0) { SF.Audio.deny(); return; }
            picking = slot;
            // simple picker: reuse the modal with inventory buttons
            var ph = '<h3>⚙ FIT MOD — slot ' + (slot + 1) + '</h3>';
            invIds.forEach(function (id) {
              var m = SF.MOD_BY_ID[id];
              ph += '<div class="mod-slot">' + modIcon(id) + '<div><div class="store-name">' +
                '<span style="color:' + (m ? m.color : '#fff') + '">' + (m ? m.name : id) + '</span> ×' + inv()[id] +
                '</div><div class="store-desc">' + (m ? m.desc : '') + '</div></div>' +
                '<button class="btn store-btn" data-mod="' + id + '">FIT</button></div>';
            });
            ph += '<button class="btn big ui-block" id="mods-back" style="margin-top:8px">BACK</button>';
            modal.innerHTML = ph;
            modal.querySelectorAll('button[data-mod]').forEach(function (mb) {
              mb.addEventListener('click', function () {
                if (self.equip(wid, picking, mb.getAttribute('data-mod'))) {
                  SF.Save.save();
                } else { SF.Audio.deny(); }
                refresh();
              });
            });
            var back = document.getElementById('mods-back');
            if (back) back.addEventListener('click', refresh);
          }
        });
      });
      var close = document.getElementById('mods-close');
      if (close) close.addEventListener('click', function () {
        modal.classList.add('hidden');
        if (SF.Station && SF.Station.renderStore) SF.Station.renderStore();
      });
    }
  };
})();

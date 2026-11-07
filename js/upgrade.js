/* STARFALL Phase 2 — upgrade.js
 * 1-5 star upgrades for parts and weapons.
 * Each star multiplies the item's stats by (1 + starStep*(stars-1)).
 * Cost: credits = basePrice * creditMul * toStar^2 * tierMul; ore = round(basePrice/oreDiv * toStar).
 */
window.SF = window.SF || {};

SF.Upgrade = (function () {
  var U = SF.CONFIG.upgrades;

  function starMult(stars) {
    return 1 + U.starStep * (Math.max(1, Math.min(5, stars)) - 1);
  }

  function costFor(basePrice, tier, toStar, creditMul) {
    var tm = SF.TIER_MUL[tier] || 1;
    return {
      credits: Math.round(basePrice * creditMul * toStar * toStar * tm),
      ore: Math.round(basePrice / U.oreDiv * toStar)
    };
  }

  function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

  return {
    starMult: starMult,
    maxStars: 5,

    partCost: function (partId, toStar) {
      var p = SF.PART_BY_ID[partId];
      if (!p || toStar < 2 || toStar > 5) return null;
      return costFor(p.price, p.tier, toStar, U.partCreditMul);
    },

    weaponCost: function (weaponId, toStar) {
      var w = SF.WEAPON_BY_ID[weaponId];
      if (!w || toStar < 2 || toStar > 5) return null;
      var base = w.price > 0 ? w.price : U.weaponBasePrice;
      return costFor(base, w.tier, toStar, U.weaponCreditMul);
    },

    costText: function (c) {
      if (!c) return '';
      return fmt(c.credits) + 'c' + (c.ore > 0 ? ' + ' + fmt(c.ore) + ' ore' : '');
    },

    canAfford: function (c) {
      return SF.Player.credits >= c.credits && SF.Player.ore >= c.ore;
    },

    pay: function (c) {
      if (!this.canAfford(c)) return false;
      SF.Player.credits -= c.credits;
      SF.Player.ore -= c.ore;
      return true;
    },

    /* Upgrade a fitted part entry in place. Returns true on success. */
    upgradePart: function (fp) {
      if (!fp || (fp.stars || 1) >= 5) return false;
      var c = this.partCost(fp.partId, (fp.stars || 1) + 1);
      if (!c || !this.pay(c)) return false;
      fp.stars = (fp.stars || 1) + 1;
      return true;
    },

    /* Upgrade an owned weapon entry {id, stars} in place. Returns true on success. */
    upgradeWeapon: function (entry) {
      if (!entry || entry.stars >= 5) return false;
      var c = this.weaponCost(entry.id, entry.stars + 1);
      if (!c || !this.pay(c)) return false;
      entry.stars++;
      return true;
    },

    starsText: function (stars) {
      var s = '';
      for (var i = 0; i < 5; i++) s += i < stars ? '★' : '☆';
      return s;
    }
  };
})();

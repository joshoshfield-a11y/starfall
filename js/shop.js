/* ============================================================
 * shop-launch phase (2026-10-23): the premium shop.
 *
 * Dark Matter (◆) is the premium currency. It is bought with real
 * money OUTSIDE the app (itch.io sells code files), and codes are
 * redeemed here. Codes are Ed25519-signed payloads minted offline;
 * this file holds only the PUBLIC key, so a code cannot be forged
 * from anything shipped in the game.
 *
 * Entitlements (DM balance, supporter status, XP boost, redeemed
 * code nonces) live in localStorage 'sf_shop_v1' — deliberately NOT
 * in the game save: purchases survive new games and save resets.
 * Paint ownership itself rides the existing paint system
 * (P.paint.owned via SF.Player.paintJobs); premium paints are
 * gated in buyPaintJob and routed here for DM payment.
 *
 * Code format: SF1-<b64url(payload JSON {"sku","n"})>.<b64url(sig)>
 * SKUs: DM250 / DM1000 / DM3000 (Dark Matter), SUPPORTER (supporter
 * status + Supporter Gilt paint + 250 DM). Each code's nonce can be
 * redeemed once per device store; re-entering a code on a fresh
 * device/store is the restore path.
 *
 * Promo codes (2026-11-02): plain-text codes for free giveaways,
 * separate from the signed paid-code path — they grant no Dark
 * Matter, so there is nothing to forge. DAWNSTAR grants the
 * Dawnstar legendary hull, once per device store (same
 * st.redeemed map, nonce 'DAWNSTAR'). The hull itself is
 * registered by-id only (Ghostwraith pattern), never in
 * SF.SHIP_CLASSES, so the shipyard can't sell it.
 * ============================================================ */
window.SF = window.SF || {};

(function () {
  'use strict';

  var LS_KEY = 'sf_shop_v1';
  var PUBKEY_HEX = '68ceefd0229582638557160e284cf2858095df70c2c835db2b82468e8313a378';
  var ITCH_URL = 'https://skiticusprime.itch.io/starfall';
  var XP_BOOST_PRICE = 300;
  var XP_BOOST_MS = 7 * 24 * 3600 * 1000;

  /* ---------------- state ---------------- */
  var st = { dm: 0, supporter: false, xpUntil: 0, redeemed: {} };
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        st.dm = p.dm | 0;
        st.supporter = !!p.supporter;
        st.xpUntil = +p.xpUntil || 0;
        st.redeemed = (p.redeemed && typeof p.redeemed === 'object') ? p.redeemed : {};
      }
    }
  } catch (e) { /* fresh store */ }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* private mode etc */ }
  }

  function spendDm(n) {
    if (st.dm < n) return false;
    st.dm -= n; save(); return true;
  }

  /* ---------------- Ed25519 verify (pure BigInt) ---------------- */
  /* ED25519-VERIFY-BEGIN */
  var ED = (function () {
    var P = (1n << 255n) - 19n;
    var L = (1n << 252n) + 27742317777372353535851937790883648493n;
    function mod(a) { a %= P; return a < 0n ? a + P : a; }
    function pow(a, e) { var r = 1n; a = mod(a); while (e > 0n) { if (e & 1n) r = mod(r * a); a = mod(a * a); e >>= 1n; } return r; }
    function inv(a) { return pow(mod(a), P - 2n); }
    var D = mod(-121665n * inv(121666n));
    var SQRT_M1 = pow(2n, (P - 1n) / 4n);
    function leToBig(bytes) {
      var x = 0n;
      for (var i = bytes.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[i]);
      return x;
    }
    function decompress(bytes) {
      if (!bytes || bytes.length !== 32) return null;
      var y = leToBig(bytes) & ((1n << 255n) - 1n);
      var sign = (bytes[31] >> 7) & 1;
      if (y >= P) return null;
      var yy = mod(y * y);
      var x2 = mod((yy - 1n) * inv(mod(D * yy + 1n)));
      var x = pow(x2, (P + 3n) / 8n);
      if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
      if (mod(x * x - x2) !== 0n) return null;
      if (Number(x & 1n) !== sign) x = P - x;
      return { x: x, y: y };
    }
    function addPt(a, b) {
      var t = mod(D * a.x * b.x * a.y * b.y);
      return {
        x: mod((a.x * b.y + b.x * a.y) * inv(1n + t)),
        y: mod((a.y * b.y + a.x * b.x) * inv(1n - t))
      };
    }
    function mulPt(pt, s) {
      var r = { x: 0n, y: 1n }, q = pt;
      while (s > 0n) { if (s & 1n) r = addPt(r, q); q = addPt(q, q); s >>= 1n; }
      return r;
    }
    var BASE = (function () {
      var y = mod(4n * inv(5n));
      var bytes = new Uint8Array(32);
      for (var i = 0; i < 32; i++) { bytes[i] = Number(y & 255n); y >>= 8n; }
      return decompress(bytes);
    })();
    /* hashBytes = SHA-512(R || A || payload), supplied by the caller
     * because WebCrypto digests are async. */
    function verify(pubBytes, sigBytes, hashBytes) {
      try {
        if (!sigBytes || sigBytes.length !== 64) return false;
        var A = decompress(pubBytes); if (!A) return false;
        var R = decompress(sigBytes.slice(0, 32)); if (!R) return false;
        var S = leToBig(sigBytes.slice(32, 64));
        if (S >= L) return false;
        var h = leToBig(hashBytes) % L;
        var left = mulPt(BASE, S);
        var right = addPt(R, mulPt(A, h));
        return left.x === right.x && left.y === right.y;
      } catch (e) { return false; }
    }
    return { verify: verify };
  })();
  /* ED25519-VERIFY-END */

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sha512(bytes) {
    return crypto.subtle.digest('SHA-512', bytes).then(function (b) {
      return new Uint8Array(b);
    });
  }

  var SKU_GRANTS = {
    DM250: { dm: 250, label: '250 ◆ Dark Matter' },
    DM1000: { dm: 1000, label: '1,000 ◆ Dark Matter' },
    DM3000: { dm: 3000, label: '3,000 ◆ Dark Matter' },
    SUPPORTER: { dm: 250, supporter: true, paint: 'gilded', label: 'Supporter Pack' }
  };

  /* Dawnstar legendary hull: registered by-id only (Ghostwraith
   * pattern) so the station shipyard, which iterates
   * SF.SHIP_CLASSES, can never sell it. Sprite:
   * assets/sprites/ships/dawnstar.png (512x512 nose-up). */
  if (window.SF && SF.SHIP_CLASS_BY_ID && !SF.SHIP_CLASS_BY_ID.dawnstar) {
    SF.SHIP_CLASS_BY_ID.dawnstar = {
      id: 'dawnstar', name: 'Dawnstar', gridW: 7, gridH: 5,
      speed: 260, hull: 340, shield: 180, crewReq: 4, cargoBonus: 20,
      price: 0, color: '#ffd23f', promoOnly: true,
      desc: 'LEGENDARY HULL. A gold-and-white strike ship out of ' +
            'nowhere, flying on a promo code. Faster than anything ' +
            'its size, and it hits like something much bigger.'
    };
  }

  function redeem(code) {
    code = String(code || '').replace(/\s+/g, '');
    /* ---- promo codes: plain text, one use per device store ---- */
    if (code.toUpperCase() === 'DAWNSTAR') {
      if (st.redeemed.DAWNSTAR) return Promise.resolve({ ok: false, reason: 'used' });
      var P = (window.SF && SF.Player) ? SF.Player : null;
      if (!P || typeof P.buyShip !== 'function' || !SF.SHIP_CLASS_BY_ID.dawnstar) {
        return Promise.resolve({ ok: false, reason: 'nogame' });
      }
      var already = false;
      try {
        already = (P.ships || []).some(function (s) { return s.classId === 'dawnstar'; });
      } catch (e) { already = false; }
      if (!already && !P.buyShip('dawnstar', 0)) {
        return Promise.resolve({ ok: false, reason: 'nogame' });
      }
      st.redeemed.DAWNSTAR = Date.now();
      save();
      try { if (window.SF && SF.Save) SF.Save.save(); } catch (e) {}
      if (window.SF && SF.HUD && SF.HUD.toast) {
        SF.HUD.toast('🌟 Dawnstar acquired — check your ships in the Shipwright.');
      }
      return Promise.resolve({ ok: true, reason: null, granted: 'Dawnstar legendary ship' });
    }
    var m = /^SF1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(code);
    if (!m) return Promise.resolve({ ok: false, reason: 'format' });
    var payload, sig;
    try { payload = b64urlDecode(m[1]); sig = b64urlDecode(m[2]); }
    catch (e) { return Promise.resolve({ ok: false, reason: 'format' }); }
    var pub = hexToBytes(PUBKEY_HEX);
    var hashInput = new Uint8Array(32 + 32 + payload.length);
    hashInput.set(sig.slice(0, 32), 0);
    hashInput.set(pub, 32);
    hashInput.set(payload, 64);
    return sha512(hashInput).then(function (h) {
      if (!ED.verify(pub, sig, h)) return { ok: false, reason: 'signature' };
      var obj;
      try { obj = JSON.parse(new TextDecoder().decode(payload)); }
      catch (e) { return { ok: false, reason: 'payload' }; }
      var grant = SKU_GRANTS[obj.sku];
      if (!grant || !obj.n) return { ok: false, reason: 'sku' };
      if (st.redeemed[obj.n]) return { ok: false, reason: 'used' };
      st.redeemed[obj.n] = Date.now();
      if (grant.dm) st.dm += grant.dm;
      if (grant.supporter) st.supporter = true;
      save();
      if (grant.paint && window.SF && SF.Player && SF.Player.paintJobs) {
        SF.Player.paintJobs.grantPaintJob(grant.paint);
      }
      return { ok: true, reason: null, granted: grant.label };
    }).catch(function () { return { ok: false, reason: 'crypto' }; });
  }

  /* ---------------- public API ---------------- */
  var Shop = {
    dm: function () { return st.dm; },
    isSupporter: function () { return st.supporter; },
    xpBoostActive: function () { return Date.now() < st.xpUntil; },
    xpUntil: function () { return st.xpUntil; },
    state: function () { return st; },
    redeem: redeem,
    /* Called by SF.Player.paintJobs.buyPaintJob for premium defs.
     * DM accounting only — paintJobs marks ownership. */
    buyPremiumPaint: function (id) {
      var def = (window.SF && SF.Player && SF.Player.paintJobs)
        ? SF.Player.paintJobs.defOf(id) : null;
      if (!def || !def.premium) return { ok: false, reason: 'invalid' };
      if (!spendDm(def.dmPrice | 0)) return { ok: false, reason: 'funds' };
      renderShop();
      return { ok: true, reason: null };
    },
    buyXpBoost: function () {
      if (!spendDm(XP_BOOST_PRICE)) return { ok: false, reason: 'funds' };
      st.xpUntil = Math.max(Date.now(), st.xpUntil) + XP_BOOST_MS;
      save(); renderShop();
      return { ok: true, reason: null };
    },
    open: openShop,
    close: closeShop
  };
  window.SF.Shop = Shop;

  /* ---------------- UI ---------------- */
  var panel = null, bodyEl = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function ensureStyle() {
    if (document.getElementById('shop-style')) return;
    var s = document.createElement('style');
    s.id = 'shop-style';
    s.textContent =
      '#overlay-shop{position:fixed;inset:0;background:rgba(3,6,16,0.72);' +
      'display:flex;align-items:center;justify-content:center;z-index:60;padding:10px}' +
      '#overlay-shop .shop-panel{max-height:94vh;overflow-y:auto;width:min(560px,96vw)}' +
      '.shop-row{display:flex;align-items:center;gap:8px;padding:7px 4px;' +
      'border-bottom:1px solid #1d3054}' +
      '.shop-row .grow{flex:1}' +
      '.shop-swatch{width:22px;height:22px;border-radius:5px;flex:none;' +
      'border:1px solid rgba(255,255,255,0.35)}' +
      '.shop-sec{font-family:var(--font-display);letter-spacing:2px;color:#9fd8ff;' +
      'margin:14px 0 4px;font-size:13px}' +
      '.shop-dm{font-size:18px;color:#ffd23f;font-weight:bold}' +
      '#shop-code{width:100%;box-sizing:border-box;background:#0b1330;' +
      'border:1px solid #2c3d6b;color:#dfe8ff;padding:8px;border-radius:6px;' +
      'font-family:monospace;font-size:12px}' +
      '.shop-status{min-height:18px;font-size:12px;margin-top:6px}';
    document.head.appendChild(s);
  }

  function ensurePanel() {
    if (panel) return panel;
    ensureStyle();
    panel = document.createElement('div');
    panel.id = 'overlay-shop';
    panel.className = 'hidden';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="panel wide shop-panel">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<h3 style="margin:0;flex:1">🛒 DARK MATTER SHOP</h3>' +
      '<span class="shop-dm" id="shop-balance"></span>' +
      '<button class="btn small ui-block" id="shop-close">✕</button>' +
      '</div>' +
      '<div id="shop-body"></div>' +
      '</div>';
    document.body.appendChild(panel);
    bodyEl = panel.querySelector('#shop-body');
    panel.querySelector('#shop-close').addEventListener('click', closeShop);
    panel.addEventListener('click', function (e) {
      if (e.target === panel) closeShop();
    });
    return panel;
  }

  function fmtDate(t) {
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderShop() {
    if (!panel || !bodyEl) return;
    var bal = panel.querySelector('#shop-balance');
    if (bal) bal.textContent = '◆ ' + st.dm + ' DM';
    var h = '';

    /* twelve-hour-wave5 sellability polish: supporter credit visibility +
     * a plain-English spending note. No prices, SKUs, or mechanics changed. */
    if (st.supporter) {
      h += '<div style="padding:8px;border:1px solid #ffd23f;border-radius:6px;color:#ffd23f;font-size:13px">' +
           '⭐ SUPPORTER — thank you. Your gold nameplate is flying.</div>';
    }
    h += '<div class="shop-sec">GET DARK MATTER</div>';
    h += '<div class="dim" style="font-size:12px">Bought on itch.io — you get a code file, redeem it below. ' +
         'Codes also restore your purchase on a new device. ' +
         'Dark Matter here buys ship paints and the 7-day XP boost below, nothing else.</div>';
    var packs = [
      { sku: 'DM250', dm: 250, price: '$1.00' },
      { sku: 'DM1000', dm: 1000, price: '$4.99' },
      { sku: 'DM3000', dm: 3000, price: '$9.99' }
    ];
    packs.forEach(function (pk) {
      h += '<div class="shop-row"><span class="grow">◆ ' + pk.dm + ' Dark Matter</span>' +
           '<a class="btn small ui-block" href="' + ITCH_URL + '" target="_blank" rel="noopener">' +
           pk.price + ' ↗</a></div>';
    });
    h += '<div class="shop-row"><span class="grow">⭐ <b>Supporter Pack</b> — supporter status, ' +
         'Supporter Gilt paint, gold nameplate, +250 ◆</span>' +
         (st.supporter ? '<b>OWNED ✓</b>'
           : '<a class="btn small ui-block" href="' + ITCH_URL + '" target="_blank" rel="noopener">$4.99 ↗</a>') +
         '</div>';

    h += '<div class="shop-sec">SPEND DARK MATTER</div>';
    if (window.SF && SF.Player && SF.Player.paintJobs) {
      var pj = SF.Player.paintJobs;
      pj.defs().filter(function (d) { return d.premium; }).forEach(function (d) {
        var owned = pj.isOwned(d.id);
        var active = pj.activeId() === d.id;
        h += '<div class="shop-row">' +
          '<span class="shop-swatch" style="background:' + (d.tint || '#999') + '"></span>' +
          '<span class="grow"><b>' + esc(d.name) + '</b><br>' +
          '<span class="dim" style="font-size:11px">' + esc(d.hint) + '</span></span>' +
          (active ? '<b>APPLIED</b>'
            : owned ? '<button class="btn small ui-block" data-shop-apply="' + d.id + '">APPLY</button>'
            : '<button class="btn small ui-block" data-shop-buy="' + d.id + '">◆ ' + d.dmPrice + '</button>') +
          '</div>';
      });
    }
    var boostOn = Shop.xpBoostActive();
    h += '<div class="shop-row"><span class="grow"><b>⚡ XP Boost +50%</b><br>' +
         '<span class="dim" style="font-size:11px">All skill XP, 7 days. Stacks by extending.' +
         (boostOn ? ' Active until ' + fmtDate(st.xpUntil) + '.' : '') + '</span></span>' +
         '<button class="btn small ui-block" id="shop-boost">◆ ' + XP_BOOST_PRICE + '</button></div>';

    h += '<div class="shop-sec">REDEEM A CODE</div>';
    h += '<input id="shop-code" class="ui-block" type="text" placeholder="SF1-… or promo code" autocomplete="off">' +
         '<div style="margin-top:8px"><button class="btn small ui-block" id="shop-redeem">REDEEM</button></div>' +
         '<div class="shop-status" id="shop-status"></div>' +
         '<div class="dim" style="font-size:11px">Promo codes are one use per device.</div>';
    h += '<div class="dim" style="font-size:11px;margin-top:10px">Purchases live on this device, ' +
         'not in your save file — a new game keeps everything you bought.</div>';
    bodyEl.innerHTML = h;

    bodyEl.querySelectorAll('[data-shop-buy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = SF.Player.paintJobs.buyPaintJob(b.getAttribute('data-shop-buy'));
        if (!r.ok && SF.HUD && SF.HUD.toast) {
          SF.HUD.toast(r.reason === 'funds' ? 'Not enough Dark Matter.' : 'Could not buy that paint.');
        }
        renderShop();
      });
    });
    bodyEl.querySelectorAll('[data-shop-apply]').forEach(function (b) {
      b.addEventListener('click', function () {
        SF.Player.paintJobs.applyPaintJob(b.getAttribute('data-shop-apply'));
        renderShop();
      });
    });
    var bb = bodyEl.querySelector('#shop-boost');
    if (bb) bb.addEventListener('click', function () {
      var r = Shop.buyXpBoost();
      if (!r.ok && SF.HUD && SF.HUD.toast) SF.HUD.toast('Not enough Dark Matter.');
      renderShop();
    });
    var rb = bodyEl.querySelector('#shop-redeem');
    if (rb) rb.addEventListener('click', function () {
      var input = bodyEl.querySelector('#shop-code');
      var status = bodyEl.querySelector('#shop-status');
      status.textContent = 'Checking…';
      Shop.redeem(input.value).then(function (r) {
        if (r.ok) {
          status.textContent = '✓ Redeemed: ' + r.granted;
          status.style.color = '#57d98a';
          input.value = '';
          if (SF.HUD && SF.HUD.toast) SF.HUD.toast('🎁 Redeemed: ' + r.granted);
        } else {
          status.textContent = r.reason === 'used' ? 'That code was already redeemed on this device.'
            : r.reason === 'nogame' ? 'Start or load a game first, then redeem.'
            : r.reason === 'format' ? 'That does not look like a STARFALL code.'
            : 'Code rejected — check it and try again.';
          status.style.color = '#ff5e3a';
        }
        renderShop();
      });
    });
  }

  function openShop() {
    ensurePanel();
    renderShop();
    panel.classList.remove('hidden');
    panel.style.display = 'flex';
  }
  function closeShop() {
    if (!panel) return;
    panel.classList.add('hidden');
    panel.style.display = 'none';
  }

  /* MENU drawer entry */
  var drawer = document.getElementById('hud-buttons');
  if (drawer && !document.getElementById('btn-shop')) {
    var btn = document.createElement('button');
    btn.id = 'btn-shop';
    btn.className = 'btn small ui-block';
    btn.textContent = '🛒 SHOP';
    btn.addEventListener('click', openShop);
    drawer.appendChild(btn);
  }
})();

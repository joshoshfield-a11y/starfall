/* dialog-sweep-1: SF.Dialog — shared in-game DOM modal.
 *
 * The Android shell (MainActivity) installs a WebViewClient but NO
 * WebChromeClient, so on device window.alert() is a silent no-op,
 * window.confirm() always returns false and window.prompt() always
 * returns null. Any flow gated on those calls is a dead button in the
 * APK (builder-drag-fix proved this for the ship builder; the pilot
 * manager on the title screen had the same disease: rename, delete and
 * NEW PILOT were all inert on the phone).
 *
 * SF.Dialog is the game-wide replacement, deliberately mirroring the
 * builder's proven modal (js/builder.js showBuilderModal/settleModal):
 * same callback shape, same one-at-a-time state, same palette (see
 * #sf-dialog in css/style.css, copied from #builder-modal). The
 * builder keeps its own overlay-scoped modal — it is proven on device
 * and lives inside the builder DOM; everything OUTSIDE the builder
 * routes through SF.Dialog instead of growing a third system.
 *
 * API (callbacks fire exactly once, only on OK unless noted):
 *   SF.Dialog.confirm(msg, onYes)          — CANCEL / CONFIRM buttons
 *   SF.Dialog.alert(msg)                   — single OK button
 *   SF.Dialog.prompt(msg, value, onOk)     — text input; onOk(value)
 *   SF.Dialog.isOpen()                     — bool (test hook)
 * Escape key or a backdrop tap settles as CANCEL. */
(function () {
  'use strict';
  window.SF = window.SF || {};
  if (SF.Dialog) return; // first definition wins

  var state = null; // { onOk, onCancel, input }
  var els = null;

  function build() {
    var wrap = document.createElement('div');
    wrap.id = 'sf-dialog';
    wrap.className = 'hidden';
    wrap.innerHTML =
      '<div class="sf-dialog-box">' +
        '<div id="sf-dialog-msg"></div>' +
        '<input id="sf-dialog-input" class="ui-block" autocomplete="off" spellcheck="false">' +
        '<div class="sf-dialog-btns">' +
          '<button id="sf-dialog-cancel" class="btn small ui-block">CANCEL</button>' +
          '<button id="sf-dialog-ok" class="btn small ui-block">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    els = {
      wrap: wrap,
      msg: wrap.querySelector('#sf-dialog-msg'),
      input: wrap.querySelector('#sf-dialog-input'),
      ok: wrap.querySelector('#sf-dialog-ok'),
      cancel: wrap.querySelector('#sf-dialog-cancel')
    };
    els.ok.addEventListener('click', function () { settle(true); });
    els.cancel.addEventListener('click', function () { settle(false); });
    // Backdrop tap = cancel (the box itself stops propagation by not
    // being the wrap target).
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) settle(false); });
    document.addEventListener('keydown', function (ev) {
      if (state && (ev.key === 'Escape' || ev.keyCode === 27)) settle(false);
    });
  }

  function show(opts) {
    if (!els) build();
    state = { onOk: opts.onOk || null, onCancel: opts.onCancel || null, input: !!opts.input };
    els.msg.textContent = opts.msg || '';
    els.input.classList.toggle('hidden', !opts.input);
    if (opts.input) els.input.value = opts.value || '';
    els.ok.textContent = opts.okLabel || 'OK';
    els.cancel.classList.toggle('hidden', !!opts.noCancel);
    els.wrap.classList.remove('hidden');
    if (opts.input) { try { els.input.focus(); els.input.select(); } catch (e) { /* focus is a nicety */ } }
  }

  function settle(ok) {
    if (!state) return;
    var st = state;
    state = null;
    var val = st.input ? els.input.value : undefined;
    els.wrap.classList.add('hidden');
    if (ok) { if (st.onOk) st.onOk(val); }
    else if (st.onCancel) st.onCancel();
  }

  SF.Dialog = {
    confirm: function (msg, onYes) {
      show({ msg: msg, okLabel: 'CONFIRM', onOk: function () { onYes(); } });
    },
    alert: function (msg) {
      show({ msg: msg, okLabel: 'OK', noCancel: true });
    },
    prompt: function (msg, value, onOk) {
      show({ msg: msg, input: true, value: value, okLabel: 'OK',
        onOk: function (v) { onOk(v); } });
    },
    isOpen: function () { return !!state; },
    _settle: settle // test hook: settle(false) == cancel
  };
})();

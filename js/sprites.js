/* STARFALL asset-loader-infra — sprites.js
 * SF.Sprites: cached Image loader for file-backed sprites, per ASSETS.md.
 * Contract: get(kind, id) returns a fully-loaded HTMLImageElement from
 *   assets/sprites/<kind>/<id>.png (or assets/ui/<id>.png for kind 'ui'),
 *   or null when the image is still loading
 *   or missing. Callers ALWAYS keep their canvas-drawn fallback: a null
 *   return means "draw procedurally", never "draw nothing".
 * Kind map (KIND_BASE): 'ui' -> assets/ui/; every other kind keeps the
 * assets/sprites/<kind>/ default, so all current call sites are unaffected.
 * The cache pins 'missing' ids so a 404 doesn't retry every frame.
 */
window.SF = window.SF || {};

SF.Sprites = (function () {
  var BASE = 'assets/sprites/';

  /* Kind map: kinds whose asset files live OUTSIDE assets/sprites/<kind>/.
   * The ui-art packs (ui-art-pack-1/2) ship under assets/ui/, so get('ui', id)
   * resolves assets/ui/<id>.png — id may carry a subpath, e.g.
   *   get('ui', 'icons/w_pulse')              -> assets/ui/icons/w_pulse.png
   *   get('ui', 'emblems/emblem_f_pirates')   -> assets/ui/emblems/emblem_f_pirates.png
   * Every other kind keeps the ASSETS.md default (BASE + kind + '/' + id).
   * Add new roots here when a new asset root appears; never special-case
   * call sites.
   */
  var KIND_BASE = {
    ui: 'assets/ui/'
  };

  function baseFor(kind) {
    return KIND_BASE.hasOwnProperty(String(kind))
      ? KIND_BASE[String(kind)]
      : BASE + kind + '/';
  }

  function srcFor(kind, id) {
    return baseFor(kind) + id + '.png';
  }

  var cache = {}; // "kind/id" -> { img, state: 'loading' | 'ready' | 'missing' }

  function k(kind, id) { return String(kind) + '/' + String(id); }

  function get(kind, id) {
    var key = k(kind, id);
    var e = cache[key];
    if (e) return e.state === 'ready' ? e.img : null;
    var img = new Image();
    cache[key] = { img: img, state: 'loading' };
    img.onload = function () { cache[key].state = 'ready'; };
    img.onerror = function () { cache[key].state = 'missing'; };
    img.onabort = function () { cache[key].state = 'missing'; };
    img.src = srcFor(kind, id);
    return null; // first call: caller draws its fallback this frame
  }

  function ready(kind, id) {
    var e = cache[k(kind, id)];
    return !!(e && e.state === 'ready');
  }

  function preload(kind, ids) {
    if (!ids || !ids.length) return;
    for (var i = 0; i < ids.length; i++) get(kind, ids[i]);
  }

  return {
    get: get,
    ready: ready,
    preload: preload,
    urlFor: srcFor, // test hook: resolved asset URL for (kind, id)
    kindBase: function (kind) { return baseFor(kind); }, // test hook
    stats: function () { // test hook
      var n = { loading: 0, ready: 0, missing: 0 };
      for (var key in cache) { if (cache.hasOwnProperty(key)) n[cache[key].state]++; }
      return n;
    }
  };
})();

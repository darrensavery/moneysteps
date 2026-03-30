// ── i18n Engine — Pocket Money PWA ─────────────────────────────────────────
// Pure vanilla JS, no dependencies. Loads after translations.js.

var i18n = (function () {

  var _lang    = 'en';
  var _db      = null;
  var _user    = null;
  var _renders = [];

  // ── Plural index ──────────────────────────────────────────────────────────

  function _pluralIndex(lang, n) {
    if (n === 0) return 0;
    if (lang === 'pl') return _pluralIndexPL(n);
    if (lang === 'fr' && n <= 1) return 1;
    if (n === 1) return 1;
    return 2;
  }

  function _pluralIndexPL(n) {
    if (n === 0) return 0;
    if (n === 1) return 1;
    var m10 = n % 10, m100 = n % 100;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return 2;
    return 3;
  }

  // ── Core ──────────────────────────────────────────────────────────────────

  function _lookup(key) {
    var dict = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[_lang]) || {};
    if (dict[key] !== undefined) return dict[key];
    var en = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS['en']) || {};
    if (en[key] !== undefined) return en[key];
    return key; // last resort: show key itself
  }

  function _interpolate(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, function (_, token) {
      return (vars[token] !== undefined) ? vars[token] : '{' + token + '}';
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function t(key, vars) {
    return _interpolate(_lookup(key), vars);
  }

  function tPlural(key, count, vars) {
    var raw   = _lookup(key);
    var parts = raw.split('|');
    var idx   = _pluralIndex(_lang, count);
    var form  = parts[Math.min(idx, parts.length - 1)] || raw;
    return _interpolate(form, Object.assign({ n: count }, vars || {}));
  }

  function applyToDOM(root) {
    var scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key  = el.getAttribute('data-i18n');
      var vars = _parseVars(el.getAttribute('data-i18n-vars'));
      el.textContent = t(key, vars);
    });

    scope.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key  = el.getAttribute('data-i18n-html');
      var vars = _parseVars(el.getAttribute('data-i18n-vars'));
      el.innerHTML = t(key, vars);
    });

    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').trim().split(/\s+/).forEach(function (pair) {
        var p = pair.split(':');
        if (p.length === 2) el.setAttribute(p[0], t(p[1]));
      });
    });

    scope.querySelectorAll('[data-i18n-plural]').forEach(function (el) {
      var key   = el.getAttribute('data-i18n-plural');
      var count = parseInt(el.getAttribute('data-i18n-count'), 10) || 0;
      var vars  = _parseVars(el.getAttribute('data-i18n-vars'));
      el.textContent = tPlural(key, count, vars);
    });
  }

  function _parseVars(attrVal) {
    if (!attrVal) return null;
    var result = {};
    attrVal.trim().split(/\s+/).forEach(function (pair) {
      var idx = pair.indexOf(':');
      if (idx > 0) result[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    return result;
  }

  function setLang(code) {
    if (typeof TRANSLATIONS === 'undefined' || !TRANSLATIONS[code]) {
      console.error('[i18n] Unknown language: ' + code); return;
    }
    _lang = code;
    applyToDOM();
    var meta = typeof LOCALE_META !== 'undefined' && LOCALE_META[code];
    if (meta) document.documentElement.lang = meta.bcp47;
    _renders.forEach(function (fn) { try { fn(); } catch (e) { console.error('[i18n]', e); } });
    if (_db && _user) {
      var update = {};
      update[_user] = { lang: code };
      _db.collection('config').doc('appconfig')
        .set(update, { merge: true })
        .catch(function (e) { console.warn('[i18n] Persist failed', e); });
    }
  }

  function init(opts) {
    _db      = opts.db      || null;
    _user    = opts.user    || null;
    _renders = opts.renders || [];
    var code = opts.lang || 'en';
    _lang = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[code]) ? code : 'en';
    var meta = typeof LOCALE_META !== 'undefined' && LOCALE_META[_lang];
    if (meta) document.documentElement.lang = meta.bcp47;
    applyToDOM();
  }

  function getLang() { return _lang; }

  function formatDate(dateVal, opts) {
    var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    var meta  = typeof LOCALE_META !== 'undefined' && LOCALE_META[_lang];
    var bcp47 = meta ? meta.bcp47 : 'en-GB';
    var options = opts || { day: 'numeric', month: 'short', year: 'numeric' };
    try { return new Intl.DateTimeFormat(bcp47, options).format(d); }
    catch (e) { return d.toLocaleDateString(); }
  }

  function formatNumber(n, opts) {
    var meta  = typeof LOCALE_META !== 'undefined' && LOCALE_META[_lang];
    var bcp47 = meta ? meta.bcp47 : 'en-GB';
    try { return new Intl.NumberFormat(bcp47, opts || {}).format(n); }
    catch (e) { return String(n); }
  }

  return { init, t, tPlural, setLang, getLang, applyToDOM, formatDate, formatNumber };

}());

// Global shorthand — wraps with child-name substitution baked in
function t(key, vars) { return i18n.t(key, vars); }
function tPlural(key, count, vars) { return i18n.tPlural(key, count, vars); }

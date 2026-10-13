// Minimal i18n: dictionaries live in locales/<code>.js and register themselves on window.__locales.
// Static markup uses data-i18n (text), data-i18n-title, data-i18n-placeholder and data-i18n-aria-label.
(() => {
  'use strict';

  const dictionaries = window.__locales || {};
  const FALLBACK = 'en';
  let lang = FALLBACK;

  function t(key, params) {
    const dict = dictionaries[lang] || {};
    let s = dict[key] ?? (dictionaries[FALLBACK] || {})[key] ?? key;
    if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? '' : String(params[k])));
    return s;
  }

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) =>
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)),
    );
    document.documentElement.lang = lang;
  }

  function setLang(code) {
    lang = dictionaries[code] ? code : FALLBACK;
    apply();
  }

  window.i18n = { t, apply, setLang, languages: () => Object.keys(dictionaries) };
  window.t = t;
})();

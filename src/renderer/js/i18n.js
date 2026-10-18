// UI language. Strings are written in English in the code and wrapped in t(), with {name}-style placeholders.
// Romanian lives in ../i18n/ro.json, keyed by the English text (shared with the main process);
// anything missing falls back to English. test/unit/i18n.test.js checks every t() call has a translation.

import ro from '../i18n/ro.json' with { type: 'json' };

let lang = 'en';

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ro', label: 'Română' },
];

export function setLanguage(l) {
  lang = l === 'ro' ? 'ro' : 'en';
  document.documentElement.lang = lang;
}

export function getLanguage() {
  return lang;
}

export function t(text, params) {
  const s = lang === 'ro' && Object.hasOwn(ro, text) ? ro[text] : text;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

/** Static markup in index.html: data-i18n (text), data-i18n-aria (aria-label), data-i18n-title (title). */
export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.dataset.i18nTitle)));
}

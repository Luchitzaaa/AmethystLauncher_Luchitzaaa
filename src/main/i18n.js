'use strict';

// Messages created in the main process (errors, progress labels) follow the UI language.
// Strings are written in English; Romanian lives in renderer/i18n/ro.json, keyed by the English text,
// and is shared with the renderer so both sides translate the same way.

const ro = require('../renderer/i18n/ro.json');

let lang = 'en';

function setLanguage(l) {
  lang = l === 'ro' ? 'ro' : 'en';
}

function getLanguage() {
  return lang;
}

/** tr(englishText, { name }) → the text in the current language, with {name}-style placeholders filled in. */
function tr(text, params) {
  const s = lang === 'ro' && Object.hasOwn(ro, text) ? ro[text] : text;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

module.exports = { setLanguage, getLanguage, tr };

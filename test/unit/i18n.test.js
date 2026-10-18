'use strict';

// Every UI string is written in English and wrapped in t() (renderer) or tr() (main process).
// This test reads the sources and checks that Romanian has a translation for each of them, with the same
// {placeholders}, and that ro.json carries nothing unused.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ro = require('../../src/renderer/i18n/ro.json');
const i18n = require('../../src/main/i18n');

const SRC = path.join(__dirname, '..', '..', 'src');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(js|html)$/.test(e.name) ? [p] : [];
  });
}

const unescape = (s) => s.replace(/\\(.)/g, '$1');

function usedKeys() {
  const keys = new Map(); // key → first file using it
  for (const file of files(SRC)) {
    if (file.endsWith('selftest.js')) continue; // test driver, not UI
    const src = fs.readFileSync(file, 'utf8');
    const add = (k) => keys.has(k) || keys.set(k, path.relative(SRC, file));
    for (const m of src.matchAll(/(?<![\w.$])(?:t|tr)\(\s*'((?:[^'\\\n]|\\.)*)'/g)) add(unescape(m[1]));
    for (const m of src.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) add(m[1]);
  }
  return keys;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every UI string has a Romanian translation with the same placeholders', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 200, `only ${keys.size} strings found: is the scanner broken?`);
  const missing = [...keys].filter(([k]) => !Object.hasOwn(ro, k)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, [], `missing in ro.json:\n${missing.join('\n')}`);
  const mismatched = [...keys.keys()].filter((k) => JSON.stringify(placeholders(k)) !== JSON.stringify(placeholders(ro[k])));
  assert.deepEqual(mismatched, [], 'placeholders differ');
});

test('ro.json has no stale entries and no untranslated copies', () => {
  const keys = usedKeys();
  const unused = Object.keys(ro).filter((k) => !keys.has(k));
  assert.deepEqual(unused, [], `unused in ro.json:\n${unused.join('\n')}`);
  // Identical text is fine for names and technical terms, but most strings must actually change.
  const same = Object.entries(ro).filter(([k, v]) => k === v).length;
  assert.ok(same < Object.keys(ro).length * 0.1, `${same} entries are not translated`);
});

test('the main process translates and fills placeholders', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.tr('Unknown account'), 'Unknown account');
  i18n.setLanguage('ro');
  assert.equal(i18n.tr('Unknown account'), ro['Unknown account']);
  assert.equal(i18n.tr('Not a translated {thing}', { thing: 'x' }), 'Not a translated x', 'unknown strings fall back to English');
  i18n.setLanguage('en');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const nbt = require('../../src/main/core/nbt');
const quickplay = require('../../src/main/core/quickplay');
const settings = require('../../src/main/core/settings');
const { buildLaunchArgs } = require('../../src/main/core/launch');

// Tiny NBT writer for fixtures: {__type, value} for explicit tags, plain JS for compounds/strings/ints.
function tag(type, value) {
  return { __type: type, value };
}
function write(v) {
  const parts = [];
  const u8 = (n) => parts.push(Buffer.from([n]));
  const str = (s) => {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(2);
    len.writeUInt16BE(b.length);
    parts.push(len, b);
  };
  const typeOf = (x) => (x?.__type ? x.__type : typeof x === 'string' ? 8 : Array.isArray(x) ? 9 : typeof x === 'object' ? 10 : 3);
  const payload = (type, x) => {
    const val = x?.__type ? x.value : x;
    if (type === 3) {
      const b = Buffer.alloc(4);
      b.writeInt32BE(val);
      parts.push(b);
    } else if (type === 4) {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(BigInt(val));
      parts.push(b);
    } else if (type === 8) str(val);
    else if (type === 9) {
      const inner = val.length ? typeOf(val[0]) : 10;
      u8(inner);
      const n = Buffer.alloc(4);
      n.writeInt32BE(val.length);
      parts.push(n);
      for (const e of val) payload(inner, e);
    } else if (type === 10) {
      for (const [k, e] of Object.entries(val)) {
        const tt = typeOf(e);
        u8(tt);
        str(k);
        payload(tt, e);
      }
      u8(0);
    }
  };
  u8(10);
  str('');
  payload(10, v);
  return Buffer.concat(parts);
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'amethyst-qp-'));

test('NBT reader: gzipped compound with strings, ints, longs and lists', () => {
  const buf = zlib.gzipSync(write({ Data: { LevelName: 'Insula mea', LastPlayed: tag(4, 1791990000000), Version: { Id: 4555 }, Tags: ['a', 'b'] } }));
  const root = nbt.parse(buf);
  assert.equal(root.Data.LevelName, 'Insula mea');
  assert.equal(root.Data.LastPlayed, 1791990000000);
  assert.equal(root.Data.Version.Id, 4555);
  assert.deepEqual(root.Data.Tags, ['a', 'b']);
  assert.throws(() => nbt.parse(Buffer.from([10, 0, 0, 8, 0, 4])), /Truncated/);
});

test('worlds are listed newest first with their real names; servers come from servers.dat', async () => {
  const game = tmp();
  const mk = (folder, name, last, icon) => {
    const dir = path.join(game, 'saves', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'level.dat'), zlib.gzipSync(write({ Data: { LevelName: name, LastPlayed: tag(4, last) } })));
    if (icon) fs.writeFileSync(path.join(dir, 'icon.png'), 'png');
  };
  mk('New World', 'Survival cu prietenii', 1000, true);
  mk('creative-1', 'Creativ', 5000, false);
  fs.mkdirSync(path.join(game, 'saves', 'not-a-world'), { recursive: true });
  const worlds = await quickplay.listWorlds(game);
  assert.deepEqual(worlds.map((w) => [w.folder, w.name, w.icon]), [['creative-1', 'Creativ', false], ['New World', 'Survival cu prietenii', true]]);

  fs.writeFileSync(path.join(game, 'servers.dat'), write({ servers: [{ name: 'Hypixel', ip: 'mc.hypixel.net' }, { ip: 'play.example.net:25570' }, { name: 'broken' }] }));
  assert.deepEqual(await quickplay.listServers(game), [{ name: 'Hypixel', ip: 'mc.hypixel.net' }, { name: 'play.example.net:25570', ip: 'play.example.net:25570' }]);
  assert.deepEqual(await quickplay.listServers(tmp()), [], 'no servers.dat');

  assert.deepEqual(await quickplay.resolve(game, { type: 'world', target: 'New World' }), { singleplayer: 'New World' });
  assert.deepEqual(await quickplay.resolve(game, { type: 'world', target: 'gone' }), { missing: 'gone' });
  assert.deepEqual(await quickplay.resolve(game, { type: 'server', target: 'mc.hypixel.net' }), { multiplayer: 'mc.hypixel.net' });
  assert.equal(await quickplay.resolve(game, { type: 'menu' }), null);
});

test('quick-play choices are sanitized (no path tricks, valid server addresses)', () => {
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'world', target: 'New World' }), { type: 'world', target: 'New World' });
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'world', target: 'w1', label: ' Insula mea\n' }), { type: 'world', target: 'w1', label: 'Insula mea' }, 'display name kept');
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'world', target: '../../etc' }), { type: 'menu', target: '' });
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'world', target: '..' }), { type: 'menu', target: '' });
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'server', target: ' play.example.net:25565 ' }), { type: 'server', target: 'play.example.net:25565' });
  assert.deepEqual(settings.sanitizeQuickPlay({ type: 'server', target: 'evil; rm -rf' }), { type: 'menu', target: '' });
  assert.deepEqual(settings.sanitizeInstance({ name: 'x' }).quickPlay, { type: 'menu', target: '' });
  assert.equal(settings.sanitizeSettings({}).language, 'en', 'English by default, also for old settings');
  assert.equal(settings.sanitizeSettings({ language: 'ro' }).language, 'ro');
});

test('quick play adds the 26.3 arguments', () => {
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-quickplay.json'), 'utf8'));
  const base = { env: { os: 'windows', arch: 'x86_64', osVersion: '10.0', features: {} }, auth: { name: 'A', uuid: '0'.repeat(32), accessToken: '0' }, memory: { min: 512, max: 1024 },
    gameDir: 'C:\\g', assetsRoot: 'C:\\a', librariesDir: 'C:\\l', nativesDir: 'C:\\n', classpath: [], clientJar: 'C:\\c.jar', classpathSeparator: ';' };
  const sp = buildLaunchArgs(version, { ...base, quickPlay: { singleplayer: 'New World' } }).game;
  assert.equal(sp[sp.indexOf('--quickPlaySingleplayer') + 1], 'New World');
  assert.ok(!sp.includes('--quickPlayMultiplayer'));
  const mp = buildLaunchArgs(version, { ...base, quickPlay: { multiplayer: 'mc.hypixel.net' } }).game;
  assert.equal(mp[mp.indexOf('--quickPlayMultiplayer') + 1], 'mc.hypixel.net');
  const none = buildLaunchArgs(version, base).game;
  assert.ok(!none.some((a) => a.startsWith('--quickPlay')));
});

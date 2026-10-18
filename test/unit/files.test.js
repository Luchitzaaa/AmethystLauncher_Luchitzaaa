'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const crypto = require('node:crypto');
const { readEntries, extractAll, listEntries } = require('../../src/main/core/zip');
const { ensureFiles } = require('../../src/main/core/download');
const mods = require('../../src/main/core/mods');
const settings = require('../../src/main/core/settings');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amethyst-test-'));
}

/** Builds a zip in memory (deflate or store) — enough to craft test fixtures, including hostile ones. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, method = 8] of entries) {
    const data = Buffer.from(content);
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc >>> 0, 14);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(data.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    locals.push(loc, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, end]);
}

test('zip: reads stored and deflated entries', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.jar');
  fs.writeFileSync(file, makeZip([['fabric.mod.json', '{"id":"x"}'], ['raw.txt', 'stored!', 0], ['big.txt', 'z'.repeat(100000)]]));
  const got = await readEntries(file, ['fabric.mod.json', 'raw.txt', 'big.txt', 'missing']);
  assert.equal(got.get('fabric.mod.json').toString(), '{"id":"x"}');
  assert.equal(got.get('raw.txt').toString(), 'stored!');
  assert.equal(got.get('big.txt').length, 100000);
  assert.equal(got.has('missing'), false);
  assert.deepEqual(await listEntries(file), ['fabric.mod.json', 'raw.txt', 'big.txt']);
});

test('zip: extraction honours excludes and refuses path traversal', async () => {
  const dir = tmpDir();
  const ok = path.join(dir, 'ok.jar');
  fs.writeFileSync(ok, makeZip([['lwjgl.dll', 'dll'], ['META-INF/MANIFEST.MF', 'x']]));
  await extractAll(ok, path.join(dir, 'out'), { exclude: ['META-INF/'] });
  assert.ok(fs.existsSync(path.join(dir, 'out', 'lwjgl.dll')));
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'META-INF')));

  const evil = path.join(dir, 'evil.jar');
  fs.writeFileSync(evil, makeZip([['../../escaped.txt', 'pwned']]));
  await assert.rejects(extractAll(evil, path.join(dir, 'out2')), /[Uu]nsafe/);
  assert.ok(!fs.existsSync(path.join(dir, 'escaped.txt')));
});

test('mods: metadata, icons, enable/disable and file-name validation', async () => {
  const dir = tmpDir();
  const icon = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.writeFileSync(path.join(dir, 'cool.jar'), makeZip([
    ['fabric.mod.json', JSON.stringify({ id: 'cool', name: 'Cool Mod', version: '1.2', description: 'd', authors: ['A', { name: 'B' }], icon: 'assets/cool/icon.png' })],
    ['assets/cool/icon.png', icon],
  ]));
  fs.writeFileSync(path.join(dir, 'notamod.jar'), 'garbage');
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'ignored');
  let list = await mods.listMods(dir);
  assert.deepEqual(list.map((m) => m.name), ['Cool Mod', 'notamod']);
  assert.deepEqual(list[0].authors, ['A', 'B']);
  assert.ok(list[0].icon.startsWith('data:image/png;base64,'));
  const renamed = await mods.setEnabled(dir, 'cool.jar', false);
  assert.equal(renamed, 'cool.jar.disabled');
  list = await mods.listMods(dir);
  assert.equal(list.find((m) => m.id === 'cool').enabled, false);
  await mods.setEnabled(dir, 'cool.jar.disabled', true);
  assert.ok(fs.existsSync(path.join(dir, 'cool.jar')));
  assert.throws(() => mods.modPath(dir, '../outside.jar'));
  assert.throws(() => mods.modPath(dir, 'evil.exe'));
});

test('downloads: hash verified, corrupt file replaced, bad hash rejected, progress reported', async () => {
  const payload = crypto.randomBytes(200000);
  const sha1 = crypto.createHash('sha1').update(payload).digest('hex');
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/flaky' && hits === 1) {
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, { 'Content-Length': payload.length });
    res.end(payload);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = tmpDir();
  try {
    const target = path.join(dir, 'sub', 'file.bin');
    const progress = [];
    await ensureFiles([{ url: `${base}/flaky`, path: target, sha1, size: payload.length }], { onProgress: (p) => progress.push(p) });
    assert.equal(fs.readFileSync(target).length, payload.length);
    assert.ok(hits >= 2, 'retried after 503');
    assert.equal(progress.at(-1).doneFiles, 1);

    hits = 10;
    const again = await ensureFiles([{ url: `${base}/x`, path: target, sha1, size: payload.length }]);
    assert.equal(again.downloaded, 0, 'valid file is not downloaded again');

    fs.writeFileSync(target, 'corrupted');
    await ensureFiles([{ url: `${base}/x`, path: target, sha1, size: payload.length }]);
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(target)).digest('hex'), sha1);

    const other = path.join(dir, 'other.bin');
    await assert.rejects(ensureFiles([{ url: `${base}/x`, path: other, sha1: '0'.repeat(40) }]), /SHA-1/);
    assert.ok(!fs.existsSync(other), 'nothing is left behind when the hash is wrong');
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.part')), []);
  } finally {
    server.close();
  }
});

test('launcher settings and instances are sanitized', () => {
  const s = settings.sanitizeSettings({ memory: { max: 99999999, min: -5 }, afterLaunch: 'explode', azureClientId: '<script>', jvmArgs: '-Xss4M "-Dpath=C:\\a b"' });
  assert.ok(s.memory.max <= settings.totalMemoryMB());
  assert.ok(s.memory.min >= 256);
  assert.equal(s.afterLaunch, 'minimize');
  assert.equal(s.azureClientId, '');
  assert.deepEqual(s.jvmArgs, ['-Xss4M', '-Dpath=C:\\a b']);

  const ids = new Set(['survival']);
  const inst = settings.sanitizeInstance({ name: 'Survival', version: '../../x', loader: { type: 'forge' } }, ids);
  assert.equal(inst.id, 'survival-2');
  assert.equal(inst.version, '26.3');
  assert.equal(inst.loader.type, 'vanilla');
  assert.equal(settings.sanitizeInstance({ name: 'Ăștia sunt țânțari' }).id, 'astia-sunt-tantari');
});

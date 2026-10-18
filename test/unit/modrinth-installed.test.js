'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const modrinth = require('../../src/main/core/modrinth');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'amethyst-v7-'));

test('search results know what is installed: Modrinth installs (even disabled) and hand-added jars', async () => {
  const mods = tmp();
  fs.writeFileSync(path.join(mods, '.amethyst-modrinth.json'), JSON.stringify({
    files: {
      'sodium-0.7.jar': { projectId: 'AANobbMI', versionId: 'v1' },
      'lithium-0.15.jar': { projectId: 'gvQqBUqZ', versionId: 'v2' },
      'deleted-1.0.jar': { projectId: 'GONE1234', versionId: 'v3' },
    },
  }));
  const list = [
    { file: 'sodium-0.7.jar', id: 'sodium', enabled: true },
    { file: 'lithium-0.15.jar.disabled', id: 'lithium', enabled: false },
    { file: 'fabric-api-0.163.jar', id: 'fabric-api', enabled: true },
  ];
  const idx = await modrinth.installedIndex(mods, list);
  assert.equal(modrinth.isInstalled({ id: 'AANobbMI', slug: 'sodium' }, idx), true);
  assert.equal(modrinth.isInstalled({ id: 'gvQqBUqZ', slug: 'lithium' }, idx), true, 'disabled still counts as installed');
  assert.equal(modrinth.isInstalled({ id: 'P7dR8mSH', slug: 'fabric-api' }, idx), true, 'added by hand, matched by mod id');
  assert.equal(modrinth.isInstalled({ id: 'GONE1234', slug: 'gone' }, idx), false, 'manifest entry without its file');
  assert.equal(modrinth.isInstalled({ id: 'YL57xq9U', slug: 'iris' }, idx), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isAllowed, mavenPath, libraryKey } = require('../../src/main/core/rules');
const { mergeVersion, resolveLibraries } = require('../../src/main/core/versions');
const { Layout } = require('../../src/main/core/layout');

const WIN = { os: 'windows', arch: 'x86_64', osVersion: '10.0.26200', features: {} };
const MAC = { os: 'osx', arch: 'arm64', osVersion: '24.0', features: {} };

test('rules: last match wins, no rules allows, no match denies', () => {
  assert.equal(isAllowed(undefined, WIN), true);
  assert.equal(isAllowed([{ action: 'allow', os: { name: 'osx' } }], WIN), false);
  assert.equal(isAllowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } }], WIN), false);
  assert.equal(isAllowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], WIN), true);
  assert.equal(isAllowed([{ action: 'allow', os: { arch: 'x86' } }], WIN), false);
  assert.equal(isAllowed([{ action: 'allow', os: { name: 'windows', version: '^10\\.' } }], WIN), true);
  assert.equal(isAllowed([{ action: 'allow', features: { has_custom_resolution: true } }], WIN), false);
  assert.equal(isAllowed([{ action: 'allow', features: { has_custom_resolution: true } }], { ...WIN, features: { has_custom_resolution: true } }), true);
});

test('maven paths and library keys', () => {
  assert.equal(mavenPath('net.fabricmc:fabric-loader:0.19.5'), 'net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar');
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.4.3:natives-windows'), 'org/lwjgl/lwjgl/3.4.3/lwjgl-3.4.3-natives-windows.jar');
  assert.equal(mavenPath('a.b:c:1.0@zip'), 'a/b/c/1.0/c-1.0.zip');
  assert.throws(() => mavenPath('broken'));
  assert.equal(libraryKey('org.ow2.asm:asm:9.10.1'), 'org.ow2.asm:asm');
  assert.equal(libraryKey('org.lwjgl:lwjgl:3.4.3:natives-windows'), 'org.lwjgl:lwjgl:natives-windows');
});

const vanilla = {
  id: '26.3',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '34' },
  javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 },
  downloads: { client: { url: 'https://x/client.jar', sha1: 'aa', size: 1 } },
  arguments: { game: ['--username', '${auth_player_name}'], jvm: ['-cp', '${classpath}'] },
  libraries: [
    { name: 'org.ow2.asm:asm:9.6', downloads: { artifact: { path: 'org/ow2/asm/asm/9.6/asm-9.6.jar', url: 'https://l/asm-9.6.jar', sha1: 'old', size: 1 } } },
    { name: 'org.lwjgl:lwjgl:3.4.3', downloads: { artifact: { path: 'org/lwjgl/lwjgl/3.4.3/lwjgl-3.4.3.jar', url: 'https://l/lwjgl.jar', sha1: 'b', size: 2 } } },
    { name: 'org.lwjgl:lwjgl:3.4.3:natives-windows', downloads: { artifact: { path: 'org/lwjgl/lwjgl/3.4.3/lwjgl-3.4.3-natives-windows.jar', url: 'https://l/n.jar', sha1: 'c', size: 3 } }, rules: [{ action: 'allow', os: { name: 'windows' } }] },
    { name: 'org.lwjgl:lwjgl:3.4.3:natives-windows-arm64', downloads: { artifact: { path: 'x/arm.jar', url: 'https://l/arm.jar', sha1: 'd', size: 4 } }, rules: [{ action: 'allow', os: { name: 'windows' } }] },
    { name: 'org.lwjgl:lwjgl:3.4.3:natives-macos', downloads: { artifact: { path: 'x/mac.jar', url: 'https://l/mac.jar', sha1: 'e', size: 5 } }, rules: [{ action: 'allow', os: { name: 'osx' } }] },
  ],
};
const fabric = {
  id: 'fabric-loader-0.19.5-26.3',
  inheritsFrom: '26.3',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
  libraries: [
    { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net/', sha1: 'new', size: 9 },
    { name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabricmc.net/' },
  ],
};

test('inheritsFrom merge: child main class, parent assets/java/client, child libraries first', () => {
  const merged = mergeVersion(fabric, { ...vanilla, jar: vanilla.id });
  assert.equal(merged.mainClass, fabric.mainClass);
  assert.equal(merged.assetIndex.id, '34');
  assert.equal(merged.javaVersion.majorVersion, 25);
  assert.equal(merged.jar, '26.3');
  assert.equal(merged.libraries[0].name, 'org.ow2.asm:asm:9.10.1');
  assert.deepEqual(merged.arguments.jvm, ['-cp', '${classpath}', '-DFabricMcEmu= net.minecraft.client.main.Main ']);
  assert.equal(merged.inheritsFrom, undefined);
});

test('library resolution: child version wins, OS/arch filtering, maven URLs for Fabric', () => {
  const layout = new Layout(path.join(__dirname, 'tmp-root'));
  const merged = mergeVersion(fabric, { ...vanilla, jar: vanilla.id });
  const { classpath, natives } = resolveLibraries(merged, WIN, layout);
  const names = classpath.map((l) => l.name);
  assert.ok(names.includes('org.ow2.asm:asm:9.10.1'));
  assert.ok(!names.includes('org.ow2.asm:asm:9.6'), 'the older parent asm must be dropped');
  assert.ok(names.includes('org.lwjgl:lwjgl:3.4.3:natives-windows'));
  assert.ok(!names.some((n) => n.endsWith('arm64')), 'arm64 natives skipped on x64');
  assert.ok(!names.some((n) => n.endsWith('macos')));
  const loader = classpath.find((l) => l.name.startsWith('net.fabricmc:fabric-loader'));
  assert.equal(loader.url, 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar');
  assert.ok(loader.path.startsWith(layout.libraries));
  assert.equal(natives.length, 0);

  const mac = resolveLibraries(vanilla, MAC, layout).classpath.map((l) => l.name);
  assert.ok(mac.includes('org.lwjgl:lwjgl:3.4.3:natives-macos'));
  assert.ok(!mac.some((n) => n.endsWith('natives-windows')));
});

test('legacy natives (pre-1.19 style) are extracted, with ${arch} substitution', () => {
  const legacy = {
    id: '1.8.9',
    libraries: [{
      name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4',
      natives: { windows: 'natives-windows-${arch}' },
      extract: { exclude: ['META-INF/'] },
      downloads: { classifiers: { 'natives-windows-64': { path: 'p/lwjgl-platform-natives-windows-64.jar', url: 'https://l/np.jar', sha1: 'f', size: 6 } } },
    }],
  };
  const { classpath, natives } = resolveLibraries(legacy, WIN, new Layout(path.join(__dirname, 'tmp-root')));
  assert.equal(classpath.length, 0);
  assert.equal(natives.length, 1);
  assert.equal(natives[0].url, 'https://l/np.jar');
  assert.deepEqual(natives[0].exclude, ['META-INF/']);
});

test('paths from remote metadata cannot escape the libraries folder', () => {
  const evil = { id: 'x', libraries: [{ name: 'a:b:1', downloads: { artifact: { path: '../../evil.jar', url: 'https://x', sha1: 'a', size: 1 } } }] };
  assert.throws(() => resolveLibraries(evil, WIN, new Layout(path.join(__dirname, 'tmp-root'))), /[Uu]nsafe/);
  assert.throws(() => new Layout('C:/x').versionJson('../../etc'), /invalid/i);
});

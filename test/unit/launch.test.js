'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLaunchArgs, toArgFile, redact, evalArguments } = require('../../src/main/core/launch');
const { LogParser } = require('../../src/main/core/logparse');

const env = { os: 'windows', arch: 'x86_64', osVersion: '10.0', features: {} };
const auth = { name: 'Steve', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', accessToken: 'SECRET.TOKEN', userType: 'msa' };
const modern = {
  id: 'fabric-loader-0.19.5-26.3',
  type: 'release',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  assetIndex: { id: '34' },
  arguments: {
    game: [
      '--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--gameDir', '${game_directory}', '--assetIndex', '${assets_index_name}',
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
      { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
      { rules: [{ action: 'allow', features: { is_quick_play_singleplayer: true } }], value: ['--quickPlaySingleplayer', '${quickPlaySingleplayer}'] },
    ],
    jvm: [
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] },
      '-Djava.library.path=${natives_directory}/java',
      '-cp', '${classpath}',
    ],
  },
};
const base = {
  env, auth, memory: { min: 1024, max: 4096 }, gameDir: 'C:\\g', assetsRoot: 'C:\\a', librariesDir: 'C:\\l', nativesDir: 'C:\\n',
  classpath: ['C:\\l\\a.jar', 'C:\\l\\b.jar'], clientJar: 'C:\\v\\26.3.jar', classpathSeparator: ';',
};

test('modern arguments: substitution, feature rules, classpath order', () => {
  const r = buildLaunchArgs(modern, base);
  assert.equal(r.mainClass, modern.mainClass);
  assert.ok(r.jvm.includes('-Xmx4096M') && r.jvm.includes('-Xms1024M'));
  assert.ok(!r.jvm.includes('-XstartOnFirstThread'), 'macOS-only argument on Windows');
  assert.equal(r.jvm[r.jvm.indexOf('-cp') + 1], 'C:\\l\\a.jar;C:\\l\\b.jar;C:\\v\\26.3.jar');
  assert.ok(r.jvm.includes('-Djava.library.path=C:\\n/java'));
  assert.deepEqual(r.game.slice(0, 4), ['--username', 'Steve', '--uuid', '069a79f444e94726a5befca90e38aaf5']);
  assert.ok(!r.game.includes('--demo'));
  assert.ok(!r.game.includes('--width'));
  assert.ok(!r.game.includes('--quickPlaySingleplayer'));
});

test('resolution and quick play switch their argument groups on', () => {
  const r = buildLaunchArgs(modern, { ...base, resolution: { width: 1600, height: 900 }, quickPlay: { singleplayer: 'My World' } });
  assert.deepEqual(r.game.slice(r.game.indexOf('--width'), r.game.indexOf('--width') + 4), ['--width', '1600', '--height', '900']);
  assert.equal(r.game[r.game.indexOf('--quickPlaySingleplayer') + 1], 'My World');
});

test('user JVM arguments come last and their -Xmx wins', () => {
  const r = buildLaunchArgs(modern, { ...base, extraJvmArgs: ['-Xmx8G', '-XX:+UseZGC'] });
  assert.equal(r.jvm.filter((a) => a.startsWith('-Xmx')).length, 1);
  assert.ok(r.jvm.includes('-Xmx8G'));
  assert.equal(r.jvm[r.jvm.length - 1], '-XX:+UseZGC');
});

test('legacy minecraftArguments string', () => {
  const legacy = { id: '1.8.9', mainClass: 'net.minecraft.client.main.Main', assets: '1.8', minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --assetsDir ${game_assets}' };
  const r = buildLaunchArgs(legacy, { ...base, gameAssets: 'C:\\a\\virtual\\legacy' });
  assert.ok(r.jvm.includes('-Djava.library.path=C:\\n'));
  assert.deepEqual(r.game, ['--username', 'Steve', '--session', 'token:SECRET.TOKEN:069a79f444e94726a5befca90e38aaf5', '--assetsDir', 'C:\\a\\virtual\\legacy']);
});

test('argfile quoting survives spaces, quotes and backslashes', () => {
  const file = toArgFile(['-cp', 'C:\\Program Files\\x.jar;C:\\a b\\y.jar', '-Dname="q"']);
  assert.equal(file, '"-cp"\n"C:\\\\Program Files\\\\x.jar;C:\\\\a b\\\\y.jar"\n"-Dname=\\"q\\""\n');
});

test('the access token never appears in what we log', () => {
  const r = buildLaunchArgs(modern, base);
  const shown = redact(r.game, [auth.accessToken]).join(' ');
  assert.ok(!shown.includes('SECRET.TOKEN'));
  assert.ok(shown.includes('••••'));
});

test('evalArguments ignores unknown variables instead of crashing', () => {
  assert.deepEqual(evalArguments(['${nope}', 'x'], env, {}), ['${nope}', 'x']);
});

test('log4j XML events and plain lines are parsed across chunk boundaries', () => {
  const out = [];
  const p = new LogParser((l) => out.push(l));
  const xml = '<log4j:Event logger="a" timestamp="1700000000000" level="WARN" thread="Render thread"><log4j:Message><![CDATA[Hello <world> & "you"]]></log4j:Message></log4j:Event>\n';
  const thrown = '<log4j:Event logger="b" timestamp="1700000000001" level="ERROR" thread="Server &amp; thread"><log4j:Message><![CDATA[Boom]]></log4j:Message><log4j:Throwable><![CDATA[java.lang.RuntimeException: x\n\tat a.b]]></log4j:Throwable></log4j:Event>\n';
  const text = `plain start line\n${xml}${thrown}Fabric says hi\n`;
  for (let i = 0; i < text.length; i += 7) p.push(text.slice(i, i + 7)); // worst case: tiny chunks
  p.flush();
  assert.deepEqual(out.map((l) => [l.level, l.text.split('\n')[0]]), [
    ['INFO', 'plain start line'],
    ['WARN', 'Hello <world> & "you"'],
    ['ERROR', 'Boom'],
    ['INFO', 'Fabric says hi'],
  ]);
  assert.equal(out[1].thread, 'Render thread');
  assert.equal(out[2].thread, 'Server & thread');
  assert.ok(out[2].text.includes('RuntimeException'));
  assert.equal(out[1].time, 1700000000000);
});

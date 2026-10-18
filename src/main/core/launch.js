'use strict';

const path = require('node:path');
const { isAllowed } = require('./rules');

const DEFAULT_GC_ARGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
];

function substitute(str, vars) {
  return str.replace(/\$\{([a-zA-Z_]+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/** Flattens Mojang's argument list ({rules, value} objects and plain strings) for the given env. */
function evalArguments(list, env, vars) {
  const out = [];
  for (const entry of list || []) {
    if (typeof entry === 'string') {
      out.push(substitute(entry, vars));
    } else if (entry && isAllowed(entry.rules, env)) {
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      for (const v of values) out.push(substitute(v, vars));
    }
  }
  return out;
}

/**
 * Pure: builds the full command line for a resolved version.
 * Nothing here touches the disk, which keeps it easy to test.
 */
function buildLaunchArgs(version, o) {
  const features = {
    has_custom_resolution: !!o.resolution,
    is_quick_play_singleplayer: !!o.quickPlay?.singleplayer,
    is_quick_play_multiplayer: !!o.quickPlay?.multiplayer,
    is_demo_user: false,
  };
  const env = { ...o.env, features };
  const sep = o.classpathSeparator || path.delimiter;
  const classpath = [...o.classpath, o.clientJar].join(sep);

  const vars = {
    auth_player_name: o.auth.name,
    version_name: version.id,
    game_directory: o.gameDir,
    assets_root: o.assetsRoot,
    game_assets: o.gameAssets || o.assetsRoot,
    assets_index_name: version.assetIndex?.id ?? version.assets ?? 'legacy',
    auth_uuid: o.auth.uuid.replace(/-/g, ''),
    auth_access_token: o.auth.accessToken,
    auth_session: `token:${o.auth.accessToken}:${o.auth.uuid.replace(/-/g, '')}`,
    clientid: o.auth.clientId || '',
    auth_xuid: o.auth.xuid || '',
    user_type: o.auth.userType || 'msa',
    user_properties: '{}',
    version_type: o.versionType || version.type || 'release',
    natives_directory: o.nativesDir,
    launcher_name: o.launcherName || 'amethyst-launcher',
    launcher_version: o.launcherVersion || '1.0.0',
    classpath,
    classpath_separator: sep,
    library_directory: o.librariesDir,
    resolution_width: o.resolution?.width ?? 854,
    resolution_height: o.resolution?.height ?? 480,
    quickPlayPath: o.quickPlay?.path || 'quickPlay/log.json',
    quickPlaySingleplayer: o.quickPlay?.singleplayer || '',
    quickPlayMultiplayer: o.quickPlay?.multiplayer || '',
    quickPlayRealms: '',
  };

  const jvm = [`-Xms${o.memory.min}M`, `-Xmx${o.memory.max}M`];
  if (o.gcArgs !== false) jvm.push(...DEFAULT_GC_ARGS);
  if (o.loggingArg) jvm.push(o.loggingArg);
  if (version.arguments?.jvm) {
    jvm.push(...evalArguments(version.arguments.jvm, env, vars));
  } else {
    jvm.push(`-Djava.library.path=${o.nativesDir}`, '-cp', classpath);
  }
  // User arguments go last so they override the defaults above.
  jvm.push(...(o.extraJvmArgs || []).map((a) => substitute(a, vars)));

  let game;
  if (version.arguments?.game) {
    game = evalArguments(version.arguments.game, env, vars);
  } else {
    game = (version.minecraftArguments || '').split(' ').filter(Boolean).map((a) => substitute(a, vars));
    if (o.resolution) game.push('--width', String(vars.resolution_width), '--height', String(vars.resolution_height));
  }

  return { jvm: dedupeMemoryFlags(jvm), mainClass: version.mainClass, game };
}

/** If the user also passed -Xmx/-Xms, theirs (the later one) wins. */
function dedupeMemoryFlags(args) {
  const lastIndex = {};
  args.forEach((a, i) => {
    const m = /^-Xm[sx]/.exec(a);
    if (m) lastIndex[m[0]] = i;
  });
  return args.filter((a, i) => {
    const m = /^-Xm[sx]/.exec(a);
    return !m || lastIndex[m[0]] === i;
  });
}

/**
 * Java @argfile contents. Every argument is quoted; inside quotes the argfile syntax
 * treats backslash as an escape, so backslashes and quotes are escaped.
 */
function toArgFile(args) {
  return args.map((a) => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join('\n') + '\n';
}

/** Removes the access token from anything we show or log. */
function redact(args, secrets) {
  return args.map((a) => secrets.reduce((s, secret) => (secret ? s.split(secret).join('••••') : s), a));
}

module.exports = { DEFAULT_GC_ARGS, substitute, evalArguments, buildLaunchArgs, toArgFile, redact };

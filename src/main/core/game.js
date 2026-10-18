'use strict';

const { tr } = require('../i18n');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { currentEnv } = require('./rules');
const { ensureFiles } = require('./download');
const { extractAll } = require('./zip');
const versions = require('./versions');
const { prepareLoader } = require('./loaders');
const { ensureRuntime, requiredRuntime, probeJava } = require('./java');
const { buildLaunchArgs, toArgFile, redact } = require('./launch');
const { LogParser } = require('./logparse');

/**
 * Everything needed before the game can start: version profile, Java, libraries, assets, natives.
 * Returns the resolved version plus the paths the launch step needs.
 */
async function prepare({ layout, instance, settings = {}, signal, onProgress = () => {} }) {
  const step = (phase, label) => onProgress({ phase, label, doneFiles: 0, totalFiles: 0, doneBytes: 0, totalBytes: 0 });

  step('version', 'Se pregătește versiunea');
  const manifest = await versions.getManifest(layout).catch(() => null);
  const versionId = await prepareLoader(layout, instance);
  const version = await versions.resolveVersion(layout, versionId, manifest);
  const gameDir = layout.instanceDir(instance.id);
  await fsp.mkdir(gameDir, { recursive: true });

  step('java', 'Se verifică Java');
  const runtime = requiredRuntime(version);
  let javaExe = instance.javaPath || settings.javaPath || null;
  let javaMajor = runtime.majorVersion;
  if (javaExe) {
    const probe = await probeJava(javaExe);
    if (!probe) throw new Error(tr('The Java you chose does not start: {path}', { path: javaExe }));
    if (probe.major < runtime.majorVersion) {
      throw new Error(tr('Minecraft {version} needs Java {need}, but {path} is Java {have}', { version: instance.version, need: runtime.majorVersion, path: javaExe, have: probe.major }));
    }
    javaMajor = probe.major;
  } else {
    javaExe = await ensureRuntime(layout, runtime, {
      signal,
      onProgress: (p) => onProgress({ ...p, label: `Java ${runtime.majorVersion}` }),
    });
  }

  const env = currentEnv();
  const libs = versions.resolveLibraries(version, env, layout);
  const client = versions.clientJarItem(version, layout);
  const logging = versions.loggingItem(version, layout);
  await ensureFiles([...libs.classpath, ...libs.natives, client, ...(logging ? [logging] : [])], {
    signal,
    phase: 'libraries',
    onProgress: (p) => onProgress({ ...p, label: tr('Libraries') }),
  });

  step('assets', 'Se verifică resursele');
  const plan = await versions.assetPlan(version, layout, { signal });
  await ensureFiles(plan.objects, {
    signal,
    phase: 'assets',
    verifyHash: !!settings.verifyAssets,
    concurrency: 24,
    onProgress: (p) => onProgress({ ...p, label: tr('Assets') }),
  });
  const gameAssets = await versions.materializeLegacyAssets(plan, layout, gameDir);

  const nativesDir = path.join(layout.natives, versionId);
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const n of libs.natives) await extractAll(n.path, nativesDir, { exclude: n.exclude });

  return { version, versionId, gameDir, javaExe, javaMajor, libs, client, logging, nativesDir, gameAssets };
}

async function newestCrashReport(gameDir, since) {
  const dir = path.join(gameDir, 'crash-reports');
  try {
    const files = await fsp.readdir(dir);
    let best = null;
    for (const f of files) {
      const st = await fsp.stat(path.join(dir, f));
      if (st.mtimeMs >= since && (!best || st.mtimeMs > best.mtime)) best = { file: path.join(dir, f), mtime: st.mtimeMs };
    }
    return best?.file ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts the prepared game. auth = {name, uuid, accessToken, xuid, userType}.
 * Returns {process, commandLine (token redacted)}; onLog gets parsed log lines, onExit {code, crashReport}.
 */
async function launch(prepared, { layout, instance, settings = {}, auth, quickPlay, onLog = () => {}, onExit = () => {} }) {
  const { version, gameDir, javaExe, javaMajor, libs, client, logging, nativesDir, gameAssets } = prepared;
  const memory = instance.memory || settings.memory || { min: 1024, max: 4096 };
  const extraJvmArgs = [...(settings.jvmArgs || []), ...(instance.jvmArgs || [])];

  const built = buildLaunchArgs(version, {
    env: currentEnv(),
    auth,
    memory,
    gameDir,
    assetsRoot: layout.assets,
    gameAssets,
    librariesDir: layout.libraries,
    nativesDir,
    classpath: libs.classpath.map((l) => l.path),
    clientJar: client.path,
    loggingArg: logging ? logging.argument.replace('${path}', logging.path) : null,
    resolution: instance.resolution || null,
    quickPlay,
    extraJvmArgs,
    launcherName: 'amethyst-launcher',
    launcherVersion: require('../../../package.json').version,
  });

  // Long classpaths can exceed the Windows command-line limit; Java 9+ reads them from an @argfile instead.
  let args;
  let argFile = null;
  if (javaMajor >= 9) {
    argFile = path.join(nativesDir, `launch-${process.pid}-${Date.now()}.args`);
    await fsp.writeFile(argFile, toArgFile(built.jvm));
    args = [`@${argFile}`, built.mainClass, ...built.game];
  } else {
    args = [...built.jvm, built.mainClass, ...built.game];
  }

  const startedAt = Date.now();
  const child = spawn(javaExe, args, { cwd: gameDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });

  const parser = new LogParser(onLog);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => parser.push(d));
  child.stderr.on('data', (d) => onLog({ time: Date.now(), level: 'ERROR', thread: 'stderr', text: d.replace(/\s+$/, '') }));

  let finished = false;
  const finish = async (code, error) => {
    if (finished) return;
    finished = true;
    parser.flush();
    if (argFile) await fsp.rm(argFile, { force: true }).catch(() => {});
    const crashReport = code !== 0 ? await newestCrashReport(gameDir, startedAt) : null;
    onExit({ code, error: error?.message ?? null, crashReport, durationMs: Date.now() - startedAt });
  };
  child.on('error', (err) => finish(-1, err));
  child.on('close', (code) => finish(code ?? -1));

  const secrets = [auth.accessToken];
  const commandLine = [javaExe, ...redact(built.jvm, secrets), built.mainClass, ...redact(built.game, secrets)];
  return { process: child, commandLine };
}

module.exports = { prepare, launch };

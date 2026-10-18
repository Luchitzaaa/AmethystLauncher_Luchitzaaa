'use strict';

const { tr } = require('../i18n');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { execFile } = require('node:child_process');
const { getJson } = require('./http');
const { ensureFiles } = require('./download');
const { safeJoin, safeSegment } = require('./layout');

// Mojang's own Java runtime index (the one the official launcher uses).
const RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function runtimePlatform() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExecutable(home) {
  if (process.platform === 'win32') return path.join(home, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', 'java');
}

/** Versions older than 1.17 have no javaVersion block and want Java 8. */
function requiredRuntime(version) {
  return version.javaVersion || { component: 'jre-legacy', majorVersion: 8 };
}

/**
 * Makes sure the Mojang runtime component is installed and returns the path to its java executable.
 * Every file is hash-checked against Mojang's manifest, so a damaged runtime repairs itself.
 */
async function ensureRuntime(layout, javaVersion, { signal, onProgress } = {}) {
  const component = safeSegment(javaVersion.component);
  const platform = runtimePlatform();
  const index = await getJson(RUNTIME_INDEX, { signal });
  const entry = index[platform]?.[component]?.[0];
  if (!entry) {
    throw new Error(
      tr('Mojang does not provide Java {major} ({component}) for {platform}. Set the Java path manually in Options.', { major: javaVersion.majorVersion, component, platform }),
    );
  }
  const home = path.join(layout.runtime, component, platform);
  const marker = path.join(home, '.amethyst-runtime.json');
  const exe = javaExecutable(home);

  try {
    const m = JSON.parse(await fsp.readFile(marker, 'utf8'));
    if (m.manifestSha1 === entry.manifest.sha1) {
      await fsp.access(exe);
      return exe;
    }
  } catch {
    /* not installed yet or outdated */
  }

  const manifest = await getJson(entry.manifest.url, { signal });
  const items = [];
  for (const [rel, f] of Object.entries(manifest.files || {})) {
    if (f.type === 'directory') {
      await fsp.mkdir(safeJoin(home, rel), { recursive: true });
    } else if (f.type === 'file' && f.downloads?.raw) {
      const raw = f.downloads.raw;
      items.push({ url: raw.url, path: safeJoin(home, rel), sha1: raw.sha1, size: raw.size, executable: f.executable });
    }
    // "link" entries only exist on macOS/Linux bundles; we never need them on Windows.
  }
  await ensureFiles(items, { signal, onProgress, phase: 'java', concurrency: 12 });
  if (process.platform !== 'win32') {
    for (const it of items) if (it.executable) await fsp.chmod(it.path, 0o755);
  }
  await fsp.writeFile(marker, JSON.stringify({ manifestSha1: entry.manifest.sha1, version: entry.version?.name }));
  return exe;
}

/** Runs `java -version` and returns the major version, or null if it isn't a working Java. */
function probeJava(exe) {
  const consoleExe = exe.replace(/javaw(\.exe)?$/i, (m) => m.replace(/javaw/i, 'java'));
  return new Promise((resolve) => {
    execFile(consoleExe, ['-version'], { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr || stdout);
      if (!m) return resolve(null);
      const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
      resolve({ major, raw: (stderr || stdout).split(/\r?\n/)[0] });
    });
  });
}

module.exports = { RUNTIME_INDEX, runtimePlatform, javaExecutable, requiredRuntime, ensureRuntime, probeJava };

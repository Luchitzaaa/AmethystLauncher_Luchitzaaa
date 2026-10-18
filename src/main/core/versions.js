'use strict';

const { tr } = require('../i18n');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { getJson } = require('./http');
const { ensureFiles, sha1File } = require('./download');
const { isAllowed, mavenPath, libraryKey } = require('./rules');
const { safeJoin } = require('./layout');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MOJANG_LIBRARIES = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';
const MANIFEST_TTL_MS = 5 * 60 * 1000;

let manifestMemo = null;

/** Mojang's version list. Falls back to the copy on disk when offline. */
async function getManifest(layout, { force = false } = {}) {
  if (!force && manifestMemo && Date.now() - manifestMemo.at < MANIFEST_TTL_MS) return manifestMemo.data;
  const file = path.join(layout.versions, 'version_manifest_v2.json');
  try {
    const data = await getJson(MANIFEST_URL, {}, { retries: 2, timeoutMs: 15000 });
    await fsp.mkdir(layout.versions, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(data));
    manifestMemo = { at: Date.now(), data };
    return data;
  } catch (err) {
    try {
      const data = JSON.parse(await fsp.readFile(file, 'utf8'));
      manifestMemo = { at: Date.now() - MANIFEST_TTL_MS + 30000, data };
      return data;
    } catch {
      throw err;
    }
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** Loads versions/<id>/<id>.json, downloading (and hash-checking) it if it is a Mojang version. */
async function ensureVersionJson(layout, id, manifest) {
  const file = layout.versionJson(id);
  const entry = manifest?.versions.find((v) => v.id === id);
  try {
    if (!entry || (await sha1File(file)) === entry.sha1) return await readJson(file);
  } catch {
    /* missing or unreadable → (re)download below */
  }
  if (!entry) throw new Error(tr('Version {id} is not installed and is not in the Mojang list', { id }));
  await ensureFiles([{ url: entry.url, path: file, sha1: entry.sha1 }]);
  return readJson(file);
}

/** Applies a child profile (e.g. Fabric) over its parent (vanilla), the way the official launcher does. */
function mergeVersion(child, parent) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  for (const key of ['assetIndex', 'assets', 'downloads', 'javaVersion', 'logging']) {
    if (child[key] === undefined && parent[key] !== undefined) merged[key] = parent[key];
  }
  merged.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;
  merged.jar = child.jar || parent.jar || parent.id;
  delete merged.inheritsFrom;
  return merged;
}

/** Resolves a version id through its inheritsFrom chain into one launchable description. */
async function resolveVersion(layout, id, manifest) {
  const chain = [];
  let current = await ensureVersionJson(layout, id, manifest);
  chain.push(current);
  while (current.inheritsFrom) {
    if (chain.length > 8) throw new Error(`inheritsFrom chain too long for ${id}`);
    current = await ensureVersionJson(layout, current.inheritsFrom, manifest);
    chain.push(current);
  }
  let resolved = chain.pop();
  resolved = { ...resolved, jar: resolved.jar || resolved.id };
  while (chain.length) resolved = mergeVersion(chain.pop(), resolved);
  resolved.id = id;
  return resolved;
}

function skipForArch(classifier, env) {
  if (!classifier) return false;
  const c = classifier.toLowerCase();
  const isArm = c.includes('arm64') || c.includes('aarch_64') || c.includes('aarch64');
  if (isArm && env.arch !== 'arm64') return true;
  if (/(^|-)x86$/.test(c) && env.arch !== 'x86') return true;
  return false;
}

/**
 * Turns the version's library list into files to download.
 * classpath: jars for -cp; natives: legacy jars whose contents get extracted into the natives directory.
 */
function resolveLibraries(version, env, layout) {
  const classpath = [];
  const natives = [];
  const seen = new Set();

  for (const lib of version.libraries || []) {
    if (!lib?.name || !isAllowed(lib.rules, env)) continue;
    const classifier = lib.name.split('@')[0].split(':')[3];
    if (skipForArch(classifier, env)) continue;

    const key = libraryKey(lib.name);
    if (seen.has(key)) continue; // child profiles come first, so their version wins
    seen.add(key);

    const artifact = lib.downloads?.artifact;
    if (artifact || !lib.natives) {
      const rel = artifact?.path || mavenPath(lib.name);
      const url = artifact?.url ?? (lib.url ? lib.url.replace(/\/?$/, '/') : MOJANG_LIBRARIES) + mavenPath(lib.name);
      if (url) {
        classpath.push({
          name: lib.name,
          path: safeJoin(layout.libraries, rel),
          url,
          sha1: artifact?.sha1 ?? lib.sha1,
          size: artifact?.size ?? lib.size,
        });
      }
    }

    const nativeClassifier = lib.natives?.[env.os];
    if (nativeClassifier) {
      const cls = nativeClassifier.replace('${arch}', env.arch === 'x86' ? '32' : '64');
      const dl = lib.downloads?.classifiers?.[cls];
      const rel = dl?.path || mavenPath(`${lib.name}:${cls}`);
      natives.push({
        name: `${lib.name}:${cls}`,
        path: safeJoin(layout.libraries, rel),
        url: dl?.url || (lib.url ? lib.url.replace(/\/?$/, '/') : MOJANG_LIBRARIES) + mavenPath(`${lib.name}:${cls}`),
        sha1: dl?.sha1,
        size: dl?.size,
        exclude: lib.extract?.exclude || ['META-INF/'],
      });
    }
  }
  return { classpath, natives };
}

function clientJarItem(version, layout) {
  const client = version.downloads?.client;
  if (!client) throw new Error(`Version ${version.id} has no downloadable client`);
  return { url: client.url, path: layout.versionJar(version.jar), sha1: client.sha1, size: client.size };
}

function loggingItem(version, layout) {
  const file = version.logging?.client?.file;
  if (!file) return null;
  return {
    url: file.url,
    path: safeJoin(path.join(layout.assets, 'log_configs'), file.id),
    sha1: file.sha1,
    size: file.size,
    argument: version.logging.client.argument,
  };
}

/** Downloads the asset index and returns the object files it lists, plus legacy layout info. */
async function assetPlan(version, layout, { signal } = {}) {
  const ai = version.assetIndex;
  if (!ai) throw new Error(`Version ${version.id} has no assetIndex`);
  const indexPath = safeJoin(path.join(layout.assets, 'indexes'), `${ai.id}.json`);
  await ensureFiles([{ url: ai.url, path: indexPath, sha1: ai.sha1, size: ai.size }], { signal });
  const index = await readJson(indexPath);
  const objects = Object.entries(index.objects || {}).map(([name, o]) => ({
    name,
    url: `${RESOURCES_URL}${o.hash.slice(0, 2)}/${o.hash}`,
    path: path.join(layout.assets, 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash,
    size: o.size,
  }));
  return { indexId: ai.id, objects, virtual: !!index.virtual, mapToResources: !!index.map_to_resources };
}

/** Pre-1.7 versions read assets from a flat "virtual" tree (or the instance's resources folder). */
async function materializeLegacyAssets(plan, layout, gameDir) {
  if (!plan.virtual && !plan.mapToResources) return null;
  const base = plan.mapToResources
    ? path.join(gameDir, 'resources')
    : path.join(layout.assets, 'virtual', plan.indexId);
  for (const obj of plan.objects) {
    const target = safeJoin(base, obj.name);
    try {
      const st = await fsp.stat(target);
      if (st.size === obj.size) continue;
    } catch {
      /* copy below */
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(obj.path, target);
  }
  return base;
}

module.exports = {
  MANIFEST_URL,
  getManifest,
  ensureVersionJson,
  mergeVersion,
  resolveVersion,
  resolveLibraries,
  clientJarItem,
  loggingItem,
  assetPlan,
  materializeLegacyAssets,
};

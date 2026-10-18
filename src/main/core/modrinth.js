'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');
const { getJson, postJson } = require('./http');
const { ensureFiles, sha1File } = require('./download');
const { tr } = require('../i18n');

const API = 'https://api.modrinth.com/v2';
const MANIFEST = '.amethyst-modrinth.json';
const FABRIC_API_PROJECT = 'P7dR8mSH';

const q = (v) => encodeURIComponent(JSON.stringify(v));

async function search({ query = '', gameVersion, loader = 'fabric', offset = 0, limit = 20 }) {
  const facets = [['project_type:mod'], [`categories:${loader}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  // Without a query the list is a recommendation: the most downloaded mods for this version first.
  const index = String(query).trim() ? 'relevance' : 'downloads';
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${q(facets)}&offset=${offset}&limit=${limit}&index=${index}`;
  const res = await getJson(url);
  return {
    total: res.total_hits,
    hits: res.hits.map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || null,
      downloads: h.downloads,
      categories: h.display_categories || h.categories || [],
    })),
  };
}

/** Newest release (falls back to beta/alpha) of a project for this game version + loader. */
async function bestVersion(projectId, gameVersion, loader) {
  const list = await getJson(
    `${API}/project/${encodeURIComponent(projectId)}/version?loaders=${q([loader])}&game_versions=${q([gameVersion])}`,
  );
  const rank = { release: 0, beta: 1, alpha: 2 };
  list.sort((a, b) => (rank[a.version_type] ?? 3) - (rank[b.version_type] ?? 3) || Date.parse(b.date_published) - Date.parse(a.date_published));
  return list[0] || null;
}

async function readManifest(modsDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(modsDir, MANIFEST), 'utf8'));
  } catch {
    return { files: {} };
  }
}

async function writeManifest(modsDir, manifest) {
  await fsp.mkdir(modsDir, { recursive: true });
  await fsp.writeFile(path.join(modsDir, MANIFEST), JSON.stringify(manifest, null, 2));
}

function safeFileName(name) {
  const base = path.basename(String(name));
  if (base !== name || !/\.jar$/i.test(base) || /[\\/:*?"<>|]/.test(base)) throw new Error(`Unsafe file name: ${name}`);
  return base;
}

/**
 * Installs a project and its required dependencies into modsDir.
 * Already-installed projects (tracked in .amethyst-modrinth.json) are skipped; an older file of the same
 * project is replaced. Returns [{projectId, file, title}] of what was added.
 */
async function install(modsDir, projectId, { gameVersion, loader = 'fabric', onProgress } = {}) {
  const manifest = await readManifest(modsDir);
  const byProject = new Map(Object.entries(manifest.files).map(([file, m]) => [m.projectId, file]));
  const added = [];
  const visiting = new Set();

  async function installOne(pid, versionId) {
    if (visiting.has(pid)) return;
    visiting.add(pid);
    const version = versionId ? await getJson(`${API}/version/${encodeURIComponent(versionId)}`) : await bestVersion(pid, gameVersion, loader);
    if (!version) throw new Error(tr('No version compatible with {loader} {version} for {project}', { loader, version: gameVersion, project: pid }));
    const existing = byProject.get(pid);
    if (existing && manifest.files[existing]?.versionId === version.id) {
      await fsp.access(path.join(modsDir, existing)).catch(() => byProject.delete(pid));
      if (byProject.has(pid)) return deps(version);
    }
    const file = version.files.find((f) => f.primary) || version.files[0];
    const name = safeFileName(file.filename);
    await ensureFiles([{ url: file.url, path: path.join(modsDir, name), sha1: file.hashes?.sha1, size: file.size }], {
      onProgress,
      phase: 'mods',
    });
    // A disabled copy of the same file would otherwise linger next to the fresh one.
    await fsp.rm(path.join(modsDir, `${name}.disabled`), { force: true });
    if (existing && existing !== name) {
      await fsp.rm(path.join(modsDir, existing), { force: true });
      delete manifest.files[existing];
    }
    manifest.files[name] = { projectId: pid, versionId: version.id, versionNumber: version.version_number };
    byProject.set(pid, name);
    added.push({ projectId: pid, file: name, version: version.version_number });
    await deps(version);
  }

  async function deps(version) {
    for (const d of version.dependencies || []) {
      if (d.dependency_type !== 'required' || !d.project_id) continue;
      await installOne(d.project_id, d.version_id || null);
    }
  }

  await installOne(projectId, null);
  await writeManifest(modsDir, manifest);
  return added;
}

/** Drops manifest entries whose files were deleted or renamed by hand. */
async function forget(modsDir, fileName) {
  const manifest = await readManifest(modsDir);
  if (manifest.files[fileName]) {
    delete manifest.files[fileName];
    await writeManifest(modsDir, manifest);
  }
}

const normId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * What is already in a mods folder, for marking search results:
 *  - projects the launcher installed from Modrinth (manifest entries whose file is still there, enabled or not);
 *  - mod ids of every jar, so mods added by hand are recognised when the id matches the Modrinth slug.
 * `list` is mods.listMods(modsDir).
 */
async function installedIndex(modsDir, list) {
  const manifest = await readManifest(modsDir);
  const present = new Set(list.map((m) => m.file.replace(/\.disabled$/i, '')));
  const projectIds = new Set();
  for (const [file, m] of Object.entries(manifest.files || {})) {
    if (present.has(file) && m?.projectId) projectIds.add(m.projectId);
  }
  const modIds = new Set(list.map((m) => normId(m.id)).filter(Boolean));
  return { projectIds, modIds };
}

function isInstalled(hit, index) {
  return index.projectIds.has(hit.id) || (!!hit.slug && index.modIds.has(normId(hit.slug)));
}

/**
 * Mods with a newer version on Modrinth for this game version + loader. Jars are identified by SHA-1, so
 * mods added by hand are found too as long as Modrinth knows the file. `list` is mods.listMods(modsDir).
 * Returns [{ file, name, enabled, projectId, current, latest, version }] (version = Modrinth version object).
 */
async function checkUpdates(modsDir, list, { gameVersion, loader = 'fabric' }) {
  const byHash = new Map();
  for (const m of list) {
    try {
      byHash.set(await sha1File(path.join(modsDir, m.file)), m);
    } catch {
      /* unreadable file: skip */
    }
  }
  if (!byHash.size) return [];
  const res = await postJson(`${API}/version_files/update`, { hashes: [...byHash.keys()], algorithm: 'sha1', loaders: [loader], game_versions: [gameVersion] });
  const out = [];
  for (const [hash, version] of Object.entries(res || {})) {
    const mod = byHash.get(hash);
    const file = version?.files?.find((f) => f.primary) || version?.files?.[0];
    if (!mod || !file || file.hashes?.sha1 === hash) continue; // already the newest
    out.push({ file: mod.file, name: mod.name, enabled: mod.enabled, projectId: version.project_id, current: mod.version || '', latest: version.version_number, version });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Replaces one mod with the version found by checkUpdates (keeps it disabled if it was). Returns the new file name. */
async function applyUpdate(modsDir, update, { onProgress, removeOld } = {}) {
  const file = update.version.files.find((f) => f.primary) || update.version.files[0];
  const name = safeFileName(file.filename);
  const target = update.enabled ? name : `${name}.disabled`;
  await ensureFiles([{ url: file.url, path: path.join(modsDir, target), sha1: file.hashes?.sha1, size: file.size }], { onProgress, phase: 'mods' });
  if (update.file !== target) await (removeOld ? removeOld(path.join(modsDir, update.file)) : fsp.rm(path.join(modsDir, update.file), { force: true }));
  const manifest = await readManifest(modsDir);
  delete manifest.files[update.file.replace(/\.disabled$/i, '')];
  manifest.files[name] = { projectId: update.projectId, versionId: update.version.id, versionNumber: update.version.version_number };
  await writeManifest(modsDir, manifest);
  return target;
}

module.exports = { API, FABRIC_API_PROJECT, search, bestVersion, install, forget, readManifest, safeFileName, installedIndex, isInstalled, checkUpdates, applyUpdate };

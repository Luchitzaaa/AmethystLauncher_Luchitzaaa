'use strict';

const { tr } = require('../i18n');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { getJson } = require('./http');

const FABRIC_META = 'https://meta.fabricmc.net/v2';

/** Fabric Loader versions that support the given Minecraft version (newest first). */
async function listFabricLoaders(gameVersion) {
  const list = await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`);
  return list.map((e) => ({ version: e.loader.version, stable: !!e.loader.stable }));
}

/** Minecraft versions Fabric supports, as a Set of ids. */
async function fabricGameVersions() {
  const list = await getJson(`${FABRIC_META}/versions/game`);
  return new Set(list.map((g) => g.version));
}

function fabricVersionId(gameVersion, loaderVersion) {
  return `fabric-loader-${loaderVersion}-${gameVersion}`;
}

/** Installs the Fabric launcher profile as versions/<id>/<id>.json and returns its id. */
async function installFabric(layout, gameVersion, loaderVersion) {
  const id = fabricVersionId(gameVersion, loaderVersion);
  const file = layout.versionJson(id);
  try {
    const existing = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (existing.id === id && existing.inheritsFrom === gameVersion) return id;
  } catch {
    /* not installed */
  }
  const profile = await getJson(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
  );
  if (profile.id !== id || profile.inheritsFrom !== gameVersion) {
    throw new Error(`Unexpected Fabric profile (${profile.id})`);
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(profile, null, 2));
  return id;
}

/** The version id to launch for an instance's game version + loader choice. */
async function prepareLoader(layout, instance) {
  const loader = instance.loader || { type: 'vanilla' };
  if (loader.type === 'fabric') {
    let lv = loader.version;
    if (!lv || lv === 'latest') {
      const loaders = await listFabricLoaders(instance.version);
      const pick = loaders.find((l) => l.stable) || loaders[0];
      if (!pick) throw new Error(tr('Fabric does not support Minecraft {version} yet', { version: instance.version }));
      lv = pick.version;
    }
    return installFabric(layout, instance.version, lv);
  }
  return instance.version;
}

module.exports = { listFabricLoaders, fabricGameVersions, fabricVersionId, installFabric, prepareLoader };

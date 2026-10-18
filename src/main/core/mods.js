'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');
const { readEntries } = require('./zip');

const ICON_LIMIT = 256 * 1024;
const metaCache = new Map(); // path → {key, meta}

function isModFile(name) {
  return /\.jar(\.disabled)?$/i.test(name);
}

/** Validates a file name coming from the UI so it can only address files directly inside modsDir. */
function modPath(modsDir, name) {
  const base = path.basename(String(name));
  if (base !== name || !isModFile(base)) throw new Error(`Invalid mod file: ${name}`);
  return path.join(modsDir, base);
}

async function readMeta(file) {
  const entries = await readEntries(file, ['fabric.mod.json', 'quilt.mod.json']);
  let meta = null;
  if (entries.has('fabric.mod.json')) {
    const j = JSON.parse(entries.get('fabric.mod.json').toString('utf8').replace(/^﻿/, ''));
    const authors = (j.authors || []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
    meta = { id: j.id, name: j.name || j.id, version: j.version, description: j.description || '', authors, icon: typeof j.icon === 'string' ? j.icon : j.icon?.['64'] || null, loader: 'fabric' };
  } else if (entries.has('quilt.mod.json')) {
    const j = JSON.parse(entries.get('quilt.mod.json').toString('utf8')).quilt_loader || {};
    meta = { id: j.id, name: j.metadata?.name || j.id, version: j.version, description: j.metadata?.description || '', authors: Object.keys(j.metadata?.contributors || {}), icon: j.metadata?.icon || null, loader: 'quilt' };
  }
  if (meta?.icon) {
    try {
      const icon = (await readEntries(file, [meta.icon.replace(/^\//, '')])).values().next().value;
      meta.iconData = icon && icon.length <= ICON_LIMIT ? `data:image/png;base64,${icon.toString('base64')}` : null;
    } catch {
      meta.iconData = null;
    }
  }
  return meta;
}

/** Lists jars in modsDir with their metadata (cached by size + mtime, so repeated listing is cheap). */
async function listMods(modsDir) {
  let names;
  try {
    names = await fsp.readdir(modsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter(isModFile)) {
    const file = path.join(modsDir, name);
    const st = await fsp.stat(file).catch(() => null);
    if (!st?.isFile()) continue;
    const key = `${st.size}:${st.mtimeMs}`;
    let cached = metaCache.get(file);
    if (cached?.key !== key) {
      let meta = null;
      try {
        meta = await readMeta(file);
      } catch {
        meta = null; // not a readable mod jar; still listed by file name
      }
      cached = { key, meta };
      metaCache.set(file, cached);
    }
    const m = cached.meta || {};
    out.push({
      file: name,
      enabled: !/\.disabled$/i.test(name),
      size: st.size,
      id: m.id || null,
      name: m.name || name.replace(/\.jar(\.disabled)?$/i, ''),
      version: m.version || '',
      description: m.description || '',
      authors: m.authors || [],
      icon: m.iconData || null,
      loader: m.loader || null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Enables/disables by renaming foo.jar ⇄ foo.jar.disabled. Returns the new file name. */
async function setEnabled(modsDir, name, enabled) {
  const from = modPath(modsDir, name);
  const base = path.basename(from).replace(/\.disabled$/i, '');
  const toName = enabled ? base : `${base}.disabled`;
  if (toName === path.basename(from)) return toName;
  await fsp.rename(from, path.join(modsDir, toName));
  return toName;
}

/**
 * Copies user-chosen .jar files into modsDir. A file with the same name is replaced (the user dropped a
 * newer build); keeping both would make Fabric refuse to start with a duplicate-mod error.
 */
async function addFiles(modsDir, files) {
  await fsp.mkdir(modsDir, { recursive: true });
  const added = [];
  for (const src of files) {
    const name = path.basename(src);
    if (!/\.jar$/i.test(name)) continue;
    await fsp.rm(path.join(modsDir, `${name}.disabled`), { force: true });
    await fsp.copyFile(src, path.join(modsDir, name));
    added.push(name);
  }
  return added;
}

module.exports = { isModFile, modPath, listMods, setEnabled, addFiles };

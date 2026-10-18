'use strict';

// "Start in": singleplayer worlds and saved servers of an instance, for launching straight into them
// (Minecraft's --quickPlaySingleplayer / --quickPlayMultiplayer).

const fsp = require('node:fs').promises;
const path = require('node:path');
const nbt = require('./nbt');

/** Worlds in <gameDir>/saves, newest first: { folder, name, lastPlayed, icon }. */
async function listWorlds(gameDir) {
  const saves = path.join(gameDir, 'saves');
  let dirs;
  try {
    dirs = await fsp.readdir(saves, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(saves, d.name);
    const levelDat = path.join(dir, 'level.dat');
    const st = await fsp.stat(levelDat).catch(() => null);
    if (!st) continue;
    let name = d.name;
    let lastPlayed = st.mtimeMs;
    try {
      const data = nbt.parse(await fsp.readFile(levelDat)).Data || {};
      if (typeof data.LevelName === 'string' && data.LevelName.trim()) name = data.LevelName.trim();
      if (Number.isFinite(data.LastPlayed) && data.LastPlayed > 0) lastPlayed = data.LastPlayed;
    } catch {
      /* unreadable level.dat: the folder name will do */
    }
    const icon = await fsp.access(path.join(dir, 'icon.png')).then(() => true, () => false);
    out.push({ folder: d.name, name, lastPlayed, icon });
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

/** Servers saved in the in-game multiplayer list: { name, ip }. */
async function listServers(gameDir) {
  try {
    const root = nbt.parse(await fsp.readFile(path.join(gameDir, 'servers.dat')));
    return (root.servers || [])
      .filter((s) => s && typeof s.ip === 'string' && s.ip.trim())
      .map((s) => ({ name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : s.ip.trim(), ip: s.ip.trim() }));
  } catch {
    return [];
  }
}

/**
 * Game arguments for an instance's quick-play choice, or null for the title screen.
 * A world that no longer exists falls back to the title screen (reported via `missing`).
 */
async function resolve(gameDir, quickPlay) {
  if (quickPlay?.type === 'world') {
    const ok = await fsp.access(path.join(gameDir, 'saves', quickPlay.target, 'level.dat')).then(() => true, () => false);
    return ok ? { singleplayer: quickPlay.target } : { missing: quickPlay.target };
  }
  if (quickPlay?.type === 'server') return { multiplayer: quickPlay.target };
  return null;
}

module.exports = { listWorlds, listServers, resolve };

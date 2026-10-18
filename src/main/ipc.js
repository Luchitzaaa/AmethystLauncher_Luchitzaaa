'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, shell, BrowserWindow, clipboard, nativeImage } = require('electron');
const settingsCore = require('./core/settings');

const EXTERNAL_HOSTS = new Set([
  'modrinth.com',
  'fabricmc.net',
  'www.minecraft.net',
  'minecraft.net',
  'portal.azure.com',
  'learn.microsoft.com',
  'aka.ms',
  'help.minecraft.net',
  'www.xbox.com',
]);

const str = (v, max = 200) => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Invalid parameter');
  return v;
};
const obj = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid parameter');
  return v;
};

/** Turns a thrown error into something the renderer can show, keeping the auth error code. */
function wrap(fn) {
  return async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: { message: err?.message || String(err), code: err?.code || null } };
    }
  };
}

function register(launcher, getWindow) {
  const handle = (channel, fn) => ipcMain.handle(channel, wrap(fn));
  const win = (event) => BrowserWindow.fromWebContents(event.sender) || getWindow();

  handle('app:info', () => launcher.info());
  handle('app:window', (event, action) => {
    const w = win(event);
    if (!w) return false;
    if (action === 'minimize') w.minimize();
    else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
    else if (action === 'close') w.close();
    return true;
  });
  handle('app:open', async (event, target) => {
    str(target, 300);
    let p;
    if (target === 'data') p = launcher.layout.root;
    else if (target === 'logs') p = launcher.layout.logs;
    else if (target.startsWith('instance:')) p = launcher.layout.instanceDir(launcher.instance(target.slice(9)).id);
    else if (target.startsWith('mods:')) p = launcher.modsDir(target.slice(5));
    else if (target.startsWith('file:')) {
      // Only files inside the launcher's data folder (e.g. crash reports) may be opened.
      p = path.resolve(target.slice(5));
      if (!p.startsWith(launcher.layout.root + path.sep)) throw new Error('Path not allowed');
    } else throw new Error('Unknown target');
    fs.mkdirSync(fs.statSync(p, { throwIfNoEntry: false })?.isFile() ? path.dirname(p) : p, { recursive: true });
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true;
  });
  handle('app:external', (event, url) => {
    const u = new URL(str(url, 500));
    if (u.protocol !== 'https:' || !EXTERNAL_HOSTS.has(u.hostname)) throw new Error('Link not allowed');
    return shell.openExternal(u.toString());
  });

  handle('settings:get', () => launcher.getSettings());
  handle('settings:set', (event, patch) => launcher.setSettings(obj(patch)));

  handle('versions:list', () => launcher.listVersions());
  handle('loaders:fabric', (event, gameVersion) => launcher.listFabricLoaders(str(gameVersion, 64)));

  handle('instances:list', () => launcher.listInstances());
  handle('instances:create', (event, data) => launcher.createInstance(obj(data)));
  handle('instances:update', (event, id, patch) => launcher.updateInstance(str(id, 64), obj(patch)));
  handle('instances:remove', (event, id, opts) => launcher.removeInstance(str(id, 64), { deleteFiles: !!opts?.deleteFiles }));

  handle('accounts:list', () => launcher.accounts.list());
  handle('accounts:login', (event) => launcher.accounts.login(win(event), launcher.getSettings().azureClientId));
  handle('accounts:select', (event, id) => launcher.accounts.select(str(id, 64)));
  handle('accounts:remove', (event, id) => launcher.accounts.remove(str(id, 64)));

  handle('launch:start', (event, id) => launcher.launch(str(id, 64), win(event)));
  handle('launch:cancel', (event, id) => launcher.cancel(str(id, 64)));
  handle('launch:kill', (event, id) => launcher.kill(str(id, 64)));

  handle('mods:list', (event, id) => launcher.listMods(str(id, 64)));
  handle('mods:toggle', (event, id, file, enabled) => launcher.toggleMod(str(id, 64), str(file, 255), !!enabled));
  handle('mods:remove', (event, id, file) => launcher.removeMod(str(id, 64), str(file, 255)));
  handle('mods:pick', async (event, id) => {
    const res = await dialog.showOpenDialog(win(event), {
      title: 'Alege moduri (.jar)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Moduri Fabric', extensions: ['jar'] }],
    });
    return res.canceled ? [] : launcher.addModFiles(str(id, 64), res.filePaths);
  });
  handle('mods:addPaths', (event, id, paths) => {
    if (!Array.isArray(paths) || paths.length > 100) throw new Error('Invalid parameter');
    return launcher.addModFiles(str(id, 64), paths.map((p) => str(p, 1000)));
  });
  handle('mods:search', (event, id, query, offset) => launcher.searchMods(str(id, 64), str(query ?? '', 100), Number(offset) || 0));
  handle('mods:install', (event, id, projectId) => launcher.installMod(str(id, 64), str(projectId, 20)));

  handle('mods:updates', (event, id) => launcher.checkModUpdates(str(id, 64)));
  handle('mods:applyUpdates', (event, id, files) => {
    if (!Array.isArray(files) || files.length > 500) throw new Error('Invalid parameter');
    return launcher.applyModUpdates(str(id, 64), files.map((f) => str(f, 255)));
  });

  handle('quickplay:options', (event, id) => launcher.quickPlayOptions(str(id, 64)));
  handle('quickplay:set', (event, id, choice) => launcher.updateInstance(str(id, 64), { quickPlay: settingsCore.sanitizeQuickPlay(obj(choice)) }).quickPlay);

  handle('shots:list', (event, id) => launcher.listScreenshots(id == null ? null : str(id, 64)));
  handle('shots:delete', (event, id, file) => launcher.deleteScreenshot(str(id, 64), str(file, 160)));
  handle('shots:copy', (event, id, file) => {
    const img = nativeImage.createFromPath(launcher.instanceFile(str(id, 64), 'screenshots', str(file, 160)));
    if (img.isEmpty()) throw new Error('Invalid image');
    clipboard.writeImage(img);
    return true;
  });
  handle('shots:reveal', (event, id, file) => {
    shell.showItemInFolder(launcher.instanceFile(str(id, 64), 'screenshots', str(file, 160)));
    return true;
  });

  handle('java:pick', async (event) => {
    const res = await dialog.showOpenDialog(win(event), {
      title: 'Alege executabilul Java',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [],
    });
    if (res.canceled) return null;
    const file = res.filePaths[0];
    return { path: file, ...(await launcher.testJava(file)) };
  });
}

module.exports = { register };

'use strict';

// The only bridge between the page and the main process. Every call returns {ok, value | error}
// from the main side; here it is unwrapped into a value or a thrown Error (with .code for auth errors).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.value;
  const err = new Error(res?.error?.message || 'Unknown error');
  err.code = res?.error?.code || null;
  throw err;
}

function on(channel, fn) {
  const listener = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('amethyst', {
  app: {
    info: () => call('app:info'),
    window: (action) => call('app:window', action),
    open: (target) => call('app:open', target),
    external: (url) => call('app:external', url),
    onWindowState: (fn) => on('window:state', fn),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  versions: {
    list: () => call('versions:list'),
    fabricLoaders: (gameVersion) => call('loaders:fabric', gameVersion),
  },
  instances: {
    list: () => call('instances:list'),
    create: (data) => call('instances:create', data),
    update: (id, patch) => call('instances:update', id, patch),
    remove: (id, opts) => call('instances:remove', id, opts),
  },
  accounts: {
    list: () => call('accounts:list'),
    login: () => call('accounts:login'),
    select: (id) => call('accounts:select', id),
    remove: (id) => call('accounts:remove', id),
  },
  launch: {
    start: (id) => call('launch:start', id),
    cancel: (id) => call('launch:cancel', id),
    kill: (id) => call('launch:kill', id),
    onProgress: (fn) => on('launch:progress', fn),
    onLog: (fn) => on('game:log', fn),
    onStarted: (fn) => on('game:started', fn),
    onExit: (fn) => on('game:exit', fn),
  },
  mods: {
    list: (id) => call('mods:list', id),
    toggle: (id, file, enabled) => call('mods:toggle', id, file, enabled),
    remove: (id, file) => call('mods:remove', id, file),
    pick: (id) => call('mods:pick', id),
    // Drag & drop: File objects carry no path in the sandbox; webUtils resolves the real path.
    addDropped: (id, files) => call('mods:addPaths', id, Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
    search: (id, query, offset) => call('mods:search', id, query, offset),
    install: (id, projectId) => call('mods:install', id, projectId),
    updates: (id) => call('mods:updates', id),
    applyUpdates: (id, files = []) => call('mods:applyUpdates', id, files),
  },
  quickPlay: {
    options: (id) => call('quickplay:options', id),
    set: (id, choice) => call('quickplay:set', id, choice),
  },
  shots: {
    list: (id = null) => call('shots:list', id),
    remove: (id, file) => call('shots:delete', id, file),
    copy: (id, file) => call('shots:copy', id, file),
    reveal: (id, file) => call('shots:reveal', id, file),
  },
  java: {
    pick: () => call('java:pick'),
  },
});

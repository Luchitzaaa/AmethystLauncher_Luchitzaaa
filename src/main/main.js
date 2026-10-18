'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, protocol, net, shell, session } = require('electron');
const { Launcher } = require('./launcher');
const ipc = require('./ipc');

const RENDERER = path.join(__dirname, '..', 'renderer');
const UI_SELFTEST = process.argv.includes('--ui-selftest');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Escape hatch for broken GPU drivers (and sandboxed test machines): software rendering.
if (process.argv.includes('--disable-gpu') || process.env.AMETHYST_DISABLE_GPU === '1') app.disableHardwareAcceleration();

if (!UI_SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  const dataDir = process.env.AMETHYST_DATA_DIR || path.join(app.getPath('appData'), '.amethyst-launcher');
  fs.mkdirSync(dataDir, { recursive: true });
  // Test runs keep Chromium's profile inside their own data folder instead of the real AppData profile.
  if (process.env.AMETHYST_DATA_DIR) app.setPath('userData', path.join(dataDir, 'electron-profile'));

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  let launcher;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // Defence in depth: no window may navigate away from the app or open popups; https links go to the browser.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1180,
      height: 740,
      minWidth: 960,
      minHeight: 620,
      frame: false,
      show: false,
      backgroundColor: '#0b0716',
      title: 'Amethyst Launcher',
      icon: path.join(RENDERER, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('app://')) e.preventDefault();
    });
    mainWindow.once('ready-to-show', () => {
      if (!UI_SELFTEST) mainWindow.show();
    });
    mainWindow.on('maximize', () => send('window:state', { maximized: true }));
    mainWindow.on('unmaximize', () => send('window:state', { maximized: false }));
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.loadURL(`app://launcher/index.html${UI_SELFTEST ? '?selftest=1' : ''}`);
    if (UI_SELFTEST) require('./ui-selftest').run(mainWindow, dataDir, () => flushAll());
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Serve the renderer from app://launcher/ with a strict path check (no file:// access from the page).
    // Two read-only routes into the data folder, for <img>:
    //   app://launcher/shots/<instance>/<file>        a screenshot (gallery)
    //   app://launcher/world-icon/<instance>/<folder>  a world's icon.png ("Start in" picker)
    // Names are validated and resolved inside the instance folder, so nothing else can be read.
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const m = /^(shots|world-icon)\/([a-z0-9][a-z0-9-]{0,47})\/([^/\\]{1,160})$/.exec(rel);
      if (m) {
        try {
          const file = m[1] === 'shots'
            ? (/\.(png|jpe?g)$/i.test(m[3]) ? launcher.instanceFile(m[2], 'screenshots', m[3]) : null)
            : launcher.instanceFile(m[2], 'saves', m[3], 'icon.png');
          if (file) return net.fetch(pathToFileURL(file).toString());
        } catch {
          /* unknown instance or a path outside it */
        }
        return new Response('Not found', { status: 404 });
      }
      const file = path.resolve(RENDERER, rel);
      if (!file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    // Deny every permission request (camera, notifications, ...); the launcher needs none.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    launcher = new Launcher({ dataDir, send });
    ipc.register(launcher, () => mainWindow);
    createWindow();
  });

  // Pending debounced writes must land before the process exits, or the last change could be lost.
  const flushAll = () => (launcher ? Promise.all([launcher.settings.flush(), launcher.instances.flush(), launcher.accounts.store.flush()]) : Promise.resolve());

  app.on('window-all-closed', () => {
    flushAll().finally(() => app.quit());
  });
}

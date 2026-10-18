'use strict';

// Drives the renderer through every page (electron . --ui-selftest), screenshots each step and fails
// on any console error. Results go to <data dir>/ui-selftest/report.json next to the PNGs.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const STEPS = [
  'home',
  'start-in',
  'start-in-world',
  'instances',
  'instance-editor',
  'close-modal',
  'mods',
  'mods-updates',
  'mods-discover',
  'mods-scroll',
  'mods-installed',
  'gallery',
  'gallery-lightbox',
  'gallery-close',
  'options-java',
  'options-account',
  'language-ro',
  'home-ro',
  'language-en',
  'console',
  'accounts',
  'fx',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(win, dataDir, beforeExit = async () => {}) {
  const outDir = path.join(dataDir, 'ui-selftest');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const consoleErrors = [];
  const results = [];

  win.webContents.on('console-message', (event) => {
    const level = event.level ?? event.params?.level;
    const message = event.message ?? event.params?.message;
    if (level === 'error' || level === 3) consoleErrors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, details) => consoleErrors.push(`renderer gone: ${details.reason}`));

  win.webContents.once('did-finish-load', async () => {
    win.show();
    let ok = true;
    try {
      for (let i = 0; i < 100; i++) {
        if (await win.webContents.executeJavaScript('!!window.__selftestReady')) break;
        await sleep(100);
      }
      for (const [i, step] of STEPS.entries()) {
        const t0 = Date.now();
        let value = null;
        let error = null;
        try {
          value = await win.webContents.executeJavaScript(`window.__selftest.step(${JSON.stringify(step)})`);
        } catch (err) {
          error = err.message;
          ok = false;
        }
        const image = await win.webContents.capturePage();
        const file = `${String(i + 1).padStart(2, '0')}-${step}.png`;
        fs.writeFileSync(path.join(outDir, file), image.toPNG());
        results.push({ step, ms: Date.now() - t0, value, error, screenshot: file });
      }
    } catch (err) {
      ok = false;
      results.push({ step: 'driver', error: err.message });
    }
    if (consoleErrors.length) ok = false;
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ok, consoleErrors, results }, null, 2));
    await beforeExit();
    app.exit(ok ? 0 : 1);
  });
}

module.exports = { run };

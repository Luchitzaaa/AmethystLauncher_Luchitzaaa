'use strict';

// Rasterises src/renderer/assets/logo.svg into the PNG/ICO icons with Electron itself (no image libraries).
// Usage: npx electron scripts/make-icons.js [extra-png-output ...]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'logo.svg'), 'utf8');
const SIZES = [256, 128, 64, 48, 32, 16];

// Keep Chromium's profile out of the user's AppData.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'amethyst-icons-')));
app.disableHardwareAcceleration();

/** Renders the SVG once at 256 px through offscreen rendering, then downsamples for the other sizes. */
async function renderMaster() {
  const size = 256;
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img style="width:${size}px;height:${size}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}"></body></html>`;
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => {
    latest = image;
  });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  for (let i = 0; i < 50 && !(latest && latest.getSize().width >= size); i++) {
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!latest) throw new Error('no frame rendered');
  const master = latest.crop({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return master;
}

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  try {
    const master = await renderMaster();
    const pngs = SIZES.map((size) => ({ size, data: (size === 256 ? master : master.resize({ width: size, height: size, quality: 'best' })).toPNG() }));
    fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), pngs[0].data);
    fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(pngs));
    for (const extra of process.argv.slice(2).filter((a) => a.endsWith('.png'))) {
      fs.mkdirSync(path.dirname(extra), { recursive: true });
      fs.writeFileSync(extra, pngs[1].data);
    }
    console.log('icons written');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});

// Builds dist/Amethyst Launcher-win32-x64/ (portable folder with AmethystLauncher.exe).
// Usage: npm run dist

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const out = await packager({
  dir: root,
  out: path.join(root, 'dist'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: pkg.productName,
  executableName: 'AmethystLauncher',
  appVersion: pkg.version,
  appCopyright: 'Amethyst Launcher',
  icon: path.join(root, 'build', 'icon.ico'),
  asar: true,
  prune: true,
  ignore: [/^\/(test|scripts|dist|build)(\/|$)/, /\.md$/, /^\/\.git/],
  win32metadata: {
    CompanyName: 'Amethyst Launcher',
    ProductName: pkg.productName,
    FileDescription: pkg.productName,
    OriginalFilename: 'AmethystLauncher.exe',
  },
});
console.log(`Gata: ${out.join(', ')}`);

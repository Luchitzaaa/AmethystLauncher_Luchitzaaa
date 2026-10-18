'use strict';

// Minimal ZIP reader (store + deflate) used for legacy natives and for reading mod metadata.
// Reads only the central directory and the entries asked for, so large jars stay cheap.

const fsp = require('node:fs').promises;
const path = require('node:path');
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

async function readCentralDirectory(fh) {
  const { size } = await fh.stat();
  const tailLen = Math.min(size, 0xffff + 22);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Invalid ZIP file (no EOCD)');
  const count = tail.readUInt16LE(eocd + 10);
  const cenSize = tail.readUInt32LE(eocd + 12);
  const cenOffset = tail.readUInt32LE(eocd + 16);
  if (cenOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 is not supported');

  const cen = await readAt(fh, cenOffset, cenSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cen.readUInt32LE(p) !== CEN_SIG) throw new Error('Corrupt ZIP central directory');
    const flags = cen.readUInt16LE(p + 8);
    const method = cen.readUInt16LE(p + 10);
    const compressedSize = cen.readUInt32LE(p + 20);
    const uncompressedSize = cen.readUInt32LE(p + 24);
    const nameLen = cen.readUInt16LE(p + 28);
    const extraLen = cen.readUInt16LE(p + 30);
    const commentLen = cen.readUInt16LE(p + 32);
    const localOffset = cen.readUInt32LE(p + 42);
    const name = cen.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntryData(fh, entry) {
  const loc = await readAt(fh, entry.localOffset, 30);
  if (loc.readUInt32LE(0) !== LOC_SIG) throw new Error(`Corrupt ZIP local header for ${entry.name}`);
  const dataStart = entry.localOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
  const raw = await readAt(fh, dataStart, entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
  throw new Error(`Unsupported compression method (${entry.method}) for ${entry.name}`);
}

async function withZip(file, fn) {
  const fh = await fsp.open(file, 'r');
  try {
    return await fn(fh, await readCentralDirectory(fh));
  } finally {
    await fh.close();
  }
}

/** Returns the contents of the named entries (Map name → Buffer); names that don't exist are absent. */
async function readEntries(file, names) {
  const wanted = new Set(names);
  return withZip(file, async (fh, entries) => {
    const out = new Map();
    for (const e of entries) {
      if (wanted.has(e.name)) out.set(e.name, await readEntryData(fh, e));
    }
    return out;
  });
}

async function listEntries(file) {
  return withZip(file, async (_fh, entries) => entries.map((e) => e.name));
}

/** Extracts every entry not matching an exclude prefix. Refuses entries that would escape destDir. */
async function extractAll(file, destDir, { exclude = [] } = {}) {
  const root = path.resolve(destDir);
  await withZip(file, async (fh, entries) => {
    for (const e of entries) {
      if (e.name.endsWith('/') || exclude.some((x) => e.name.startsWith(x))) continue;
      const target = path.resolve(root, e.name);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`Unsafe ZIP entry: ${e.name}`);
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, await readEntryData(fh, e));
    }
  });
}

module.exports = { readEntries, listEntries, extractAll };

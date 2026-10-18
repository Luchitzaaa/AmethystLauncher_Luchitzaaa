'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { once } = require('node:events');
const { USER_AGENT, HttpError, sleep } = require('./http');
const { tr } = require('../i18n');

const IDLE_TIMEOUT_MS = 20000;

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Files already hashed during this process, keyed by path → "size:mtime:sha1". Avoids re-hashing on every launch. */
const verifiedCache = new Map();

async function isValid(item, verifyHash) {
  let st;
  try {
    st = await fsp.stat(item.path);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (item.size != null && st.size !== item.size) return false;
  if (!verifyHash || !item.sha1) return true;
  const key = `${st.size}:${st.mtimeMs}:${item.sha1.toLowerCase()}`;
  if (verifiedCache.get(item.path) === key) return true;
  const ok = (await sha1File(item.path)) === item.sha1.toLowerCase();
  if (ok) verifiedCache.set(item.path, key);
  return ok;
}

/** Streams one file to disk, hashing as it goes; the file only appears at its final path once verified. */
async function downloadFile(item, { signal, onBytes = () => {}, retries = 3 } = {}) {
  await fsp.mkdir(path.dirname(item.path), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const tmp = `${item.path}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
    let received = 0;
    const idle = new AbortController();
    let idleTimer = setTimeout(() => idle.abort(new Error(tr('The connection stalled'))), IDLE_TIMEOUT_MS);
    const bump = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(new Error(tr('The connection stalled'))), IDLE_TIMEOUT_MS);
    };
    try {
      const res = await fetch(item.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal,
      });
      if (!res.ok) throw new HttpError(res.status, item.url, '');
      const hash = crypto.createHash('sha1');
      const out = fs.createWriteStream(tmp);
      try {
        for await (const chunk of Readable.fromWeb(res.body)) {
          bump();
          hash.update(chunk);
          received += chunk.length;
          onBytes(chunk.length);
          if (!out.write(chunk)) await once(out, 'drain');
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (item.size != null && received !== item.size) {
        throw new Error(tr('Wrong size for {file} ({got} instead of {want})', { file: path.basename(item.path), got: received, want: item.size }));
      }
      const digest = hash.digest('hex');
      if (item.sha1 && digest !== item.sha1.toLowerCase()) {
        throw new Error(tr('Wrong SHA-1 for {file}', { file: path.basename(item.path) }));
      }
      await fsp.rename(tmp, item.path);
      const st = await fsp.stat(item.path);
      if (item.sha1) verifiedCache.set(item.path, `${st.size}:${st.mtimeMs}:${digest}`);
      return;
    } catch (err) {
      lastErr = err;
      onBytes(-received);
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (signal?.aborted) throw signal.reason ?? err;
      const fatal = err instanceof HttpError && err.status !== 429 && err.status < 500;
      if (fatal || attempt === retries) break;
      await sleep(500 * 2 ** attempt + Math.random() * 300);
    } finally {
      clearTimeout(idleTimer);
    }
  }
  throw lastErr;
}

async function pool(items, concurrency, worker) {
  let index = 0;
  let failed = null;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (err) {
        failed = failed || err;
      }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
}

/**
 * Ensures every item ({url, path, sha1?, size?}) exists and is valid, downloading what is missing.
 * Progress is reported as {phase, doneFiles, totalFiles, doneBytes, totalBytes}, throttled to ~10/s.
 */
async function ensureFiles(items, { concurrency = 16, signal, verifyHash = true, onProgress = () => {}, phase = '' } = {}) {
  const unique = [...new Map(items.map((i) => [path.resolve(i.path), i])).values()];

  const missing = [];
  await pool(unique, 64, async (item) => {
    if (signal?.aborted) throw signal.reason;
    if (!(await isValid(item, verifyHash))) missing.push(item);
  });

  const totalFiles = missing.length;
  const totalBytes = missing.reduce((s, i) => s + (i.size || 0), 0);
  // Some maven libraries come without a size; then progress is measured in files instead of bytes.
  const bytesKnown = missing.every((i) => i.size != null);
  let doneFiles = 0;
  let doneBytes = 0;
  let lastEmit = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 100) return;
    lastEmit = now;
    onProgress({ phase, doneFiles, totalFiles, doneBytes: Math.max(0, doneBytes), totalBytes, bytesKnown });
  };
  emit(true);

  // Largest files first so the long downloads overlap with the swarm of small ones.
  missing.sort((a, b) => (b.size || 0) - (a.size || 0));
  await pool(missing, concurrency, async (item) => {
    await downloadFile(item, {
      signal,
      onBytes: (n) => {
        doneBytes += n;
        emit(false);
      },
    });
    doneFiles++;
    emit(false);
  });
  emit(true);
  return { downloaded: totalFiles, checked: unique.length };
}

module.exports = { sha1File, isValid, downloadFile, ensureFiles, pool };

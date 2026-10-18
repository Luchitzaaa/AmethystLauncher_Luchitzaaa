'use strict';

const { version } = require('../../../package.json');

const USER_AGENT = `AmethystLauncher/${version}`;

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // Network level failures (ECONNRESET, ETIMEDOUT, DNS hiccups, aborted by our own timeout).
  return err.name === 'TypeError' || err.name === 'AbortError' || err.name === 'TimeoutError' || !!err.code;
}

/**
 * fetch() with a per-attempt timeout, retries with exponential backoff on 429/5xx/network errors,
 * and a consistent User-Agent. 4xx responses (other than 429) are returned to the caller untouched.
 */
async function request(url, opts = {}, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const res = await fetch(url, {
        ...opts,
        signal,
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(res.status, url, await res.text().catch(() => ''));
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw opts.signal.reason ?? err;
      if (!isRetryable(err) || attempt === retries) break;
      await sleep(400 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr;
}

async function getJson(url, opts = {}, retryOpts) {
  const res = await request(url, opts, retryOpts);
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return res.json();
}

async function postJson(url, body, opts = {}, retryOpts) {
  const res = await request(
    url,
    {
      ...opts,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
      body: JSON.stringify(body),
    },
    retryOpts,
  );
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error bodies are reported through HttpError below */
  }
  if (!res.ok) {
    const err = new HttpError(res.status, url, text);
    err.json = json;
    throw err;
  }
  return json;
}

module.exports = { USER_AGENT, HttpError, request, getJson, postJson, sleep };

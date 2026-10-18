'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

/**
 * A JSON document on disk with atomic, debounced writes.
 * Reads are synchronous once at startup; every change goes through set()/update().
 */
class JsonStore {
  constructor(file, defaults, sanitize = (v) => v) {
    this.file = file;
    this.sanitize = sanitize;
    this.timer = null;
    this.writing = Promise.resolve();
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = undefined;
    }
    this.data = sanitize(data === undefined ? structuredClone(defaults) : data);
  }

  get() {
    return this.data;
  }

  set(next) {
    this.data = this.sanitize(next);
    this.scheduleSave();
    return this.data;
  }

  update(fn) {
    return this.set(fn(structuredClone(this.data)) ?? this.data);
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    const json = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, this.file);
    }).catch((err) => console.error(`Nu pot salva ${this.file}:`, err));
    return this.writing;
  }
}

module.exports = { JsonStore };

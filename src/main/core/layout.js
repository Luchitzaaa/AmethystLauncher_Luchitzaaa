'use strict';

const path = require('node:path');

/** All on-disk locations under the launcher's data root. */
class Layout {
  constructor(root) {
    this.root = path.resolve(root);
    this.versions = path.join(this.root, 'versions');
    this.libraries = path.join(this.root, 'libraries');
    this.assets = path.join(this.root, 'assets');
    this.runtime = path.join(this.root, 'runtime');
    this.natives = path.join(this.root, 'natives');
    this.instances = path.join(this.root, 'instances');
    this.logs = path.join(this.root, 'logs');
    this.cache = path.join(this.root, 'cache');
  }

  versionDir(id) {
    return path.join(this.versions, safeSegment(id));
  }

  versionJson(id) {
    return path.join(this.versionDir(id), `${safeSegment(id)}.json`);
  }

  versionJar(id) {
    return path.join(this.versionDir(id), `${safeSegment(id)}.jar`);
  }

  library(relPath) {
    return safeJoin(this.libraries, relPath);
  }

  instanceDir(id) {
    return path.join(this.instances, safeSegment(id));
  }
}

/** Version and instance ids come from remote metadata or user input; keep them to one path segment. */
function safeSegment(name) {
  const s = String(name);
  if (!s || s === '.' || s === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(s)) {
    throw new Error(`Invalid name: ${JSON.stringify(s)}`);
  }
  return s;
}

/** Joins a relative path from remote metadata under base, refusing anything that escapes it. */
function safeJoin(base, rel) {
  const root = path.resolve(base);
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) throw new Error(`Unsafe path: ${rel}`);
  return target;
}

module.exports = { Layout, safeSegment, safeJoin };

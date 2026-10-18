'use strict';

const os = require('node:os');

/** The environment Mojang's version rules are evaluated against. */
function currentEnv(features = {}) {
  return {
    os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux',
    arch: process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x86_64',
    osVersion: os.release(),
    features,
  };
}

function ruleMatches(rule, env) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== env.os) return false;
    if (rule.os.arch && rule.os.arch !== env.arch) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(env.osVersion)) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if (Boolean(env.features?.[key]) !== expected) return false;
    }
  }
  return true;
}

/** Last matching rule wins; no rules means allowed; rules with no match means disallowed. */
function isAllowed(rules, env) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, env)) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** "group:artifact:version[:classifier][@ext]" -> relative maven path (forward slashes). */
function mavenPath(coord) {
  let ext = 'jar';
  let spec = coord;
  const at = spec.indexOf('@');
  if (at !== -1) {
    ext = spec.slice(at + 1);
    spec = spec.slice(0, at);
  }
  const parts = spec.split(':');
  if (parts.length < 3) throw new Error(`Invalid maven coordinate: ${coord}`);
  const [group, artifact, version, classifier] = parts;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/** Identity of a library ignoring its version, used to let child profiles override parent libraries. */
function libraryKey(coord) {
  const [group, artifact, , classifier] = coord.split('@')[0].split(':');
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
}

module.exports = { currentEnv, ruleMatches, isAllowed, mavenPath, libraryKey };

'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { app, shell } = require('electron');
const { Layout } = require('./core/layout');
const { JsonStore } = require('./store');
const settingsCore = require('./core/settings');
const versions = require('./core/versions');
const loaders = require('./core/loaders');
const game = require('./core/game');
const mods = require('./core/mods');
const modrinth = require('./core/modrinth');
const { probeJava } = require('./core/java');
const { Accounts } = require('./accounts');
const quickplay = require('./core/quickplay');
const i18n = require('./i18n');

const { tr } = i18n;

const LOG_FLUSH_MS = 120;

/** Everything the UI can ask for, independent of IPC plumbing. */
class Launcher {
  constructor({ dataDir, send }) {
    this.layout = new Layout(dataDir);
    this.send = send; // (channel, payload) → renderer
    this.settings = new JsonStore(path.join(dataDir, 'settings.json'), settingsCore.DEFAULTS, settingsCore.sanitizeSettings);
    this.instances = new JsonStore(path.join(dataDir, 'instances.json'), { instances: [settingsCore.DEFAULT_INSTANCE] }, (d) => {
      const list = Array.isArray(d?.instances) ? d.instances : [];
      const ids = new Set();
      const out = [];
      for (const raw of list) {
        const inst = settingsCore.sanitizeInstance(raw, ids);
        if (ids.has(inst.id)) continue;
        ids.add(inst.id);
        out.push(inst);
      }
      if (out.length === 0) out.push(settingsCore.sanitizeInstance(settingsCore.DEFAULT_INSTANCE));
      return { instances: out };
    });
    this.accounts = new Accounts(dataDir);
    this.running = new Map(); // instanceId → {child, startedAt}
    this.preparing = new Map(); // instanceId → AbortController
    this.updateCache = new Map(); // instanceId → last checkModUpdates result
    i18n.setLanguage(this.settings.get().language);
  }

  // ------------------------------------------------------------- basics

  info() {
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDir: this.layout.root,
      totalMemoryMB: settingsCore.totalMemoryMB(),
      secureStorage: this.accounts.canPersist(),
      electron: process.versions.electron,
    };
  }

  getSettings() {
    return this.settings.get();
  }

  setSettings(patch) {
    const next = this.settings.update((s) => ({ ...s, ...patch, memory: { ...s.memory, ...(patch.memory || {}) } }));
    i18n.setLanguage(next.language);
    return next;
  }

  // ------------------------------------------------------------- versions & instances

  async listVersions() {
    const manifest = await versions.getManifest(this.layout);
    let fabric = new Set();
    try {
      fabric = await loaders.fabricGameVersions();
    } catch {
      /* offline: Fabric support just isn't shown */
    }
    const snapshots = this.settings.get().showSnapshots;
    return {
      latest: manifest.latest,
      versions: manifest.versions
        .filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot'))
        .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, fabric: fabric.has(v.id) })),
    };
  }

  listFabricLoaders(gameVersion) {
    return loaders.listFabricLoaders(gameVersion);
  }

  listInstances() {
    return this.instances.get().instances.map((i) => ({
      ...i,
      running: this.running.has(i.id),
      preparing: this.preparing.has(i.id),
    }));
  }

  instance(id) {
    const inst = this.instances.get().instances.find((i) => i.id === id);
    if (!inst) throw new Error(tr('Instance not found'));
    return inst;
  }

  createInstance(data) {
    let created;
    this.instances.update((d) => {
      const ids = new Set(d.instances.map((i) => i.id));
      created = settingsCore.sanitizeInstance({ ...data, id: undefined, created: Date.now() }, ids);
      return { instances: [...d.instances, created] };
    });
    this.setSettings({ selectedInstance: created.id });
    return created;
  }

  updateInstance(id, patch) {
    let updated;
    this.instances.update((d) => ({
      instances: d.instances.map((i) => {
        if (i.id !== id) return i;
        updated = settingsCore.sanitizeInstance({ ...i, ...patch, id: i.id, created: i.created });
        return updated;
      }),
    }));
    if (!updated) throw new Error(tr('Instance not found'));
    return updated;
  }

  async removeInstance(id, { deleteFiles = false } = {}) {
    if (this.running.has(id) || this.preparing.has(id)) throw new Error(tr('The instance is running. Close the game first.'));
    this.instance(id);
    this.instances.update((d) => ({ instances: d.instances.filter((i) => i.id !== id) }));
    if (deleteFiles) {
      const dir = this.layout.instanceDir(id);
      if (fs.existsSync(dir)) await shell.trashItem(dir); // recoverable from the Recycle Bin
    }
    const remaining = this.instances.get().instances;
    if (this.settings.get().selectedInstance === id) this.setSettings({ selectedInstance: remaining[0].id });
    return true;
  }

  // ------------------------------------------------------------- launching

  async launch(id, parentWindow) {
    if (this.running.has(id)) throw new Error(tr('The game is already running for this instance.'));
    if (this.preparing.has(id)) throw new Error(tr('The instance is already being prepared.'));
    const instance = this.instance(id);
    const settings = this.settings.get();
    const abort = new AbortController();
    this.preparing.set(id, abort);
    const progress = (p) => this.send('launch:progress', { id, ...p });
    try {
      progress({ phase: 'auth', label: tr('Checking the account') });
      const auth = await this.accounts.launchAuth(settings.azureClientId);
      const prepared = await game.prepare({ layout: this.layout, instance, settings, signal: abort.signal, onProgress: progress });
      const gameDir = prepared.gameDir;

      progress({ phase: 'launching', label: tr('Starting Minecraft') });
      // "Start in": straight into a world or onto a server instead of the title screen.
      const qp = await quickplay.resolve(gameDir, instance.quickPlay);
      const logBuffer = [];
      let flushTimer = null;
      const flush = () => {
        flushTimer = null;
        if (logBuffer.length) this.send('game:log', { id, lines: logBuffer.splice(0) });
      };
      const { process: child, commandLine } = await game.launch(prepared, {
        layout: this.layout,
        instance,
        settings,
        auth,
        quickPlay: qp && !qp.missing ? qp : undefined,
        onLog: (line) => {
          logBuffer.push(line);
          if (!flushTimer) flushTimer = setTimeout(flush, LOG_FLUSH_MS);
        },
        onExit: (result) => {
          flush();
          const run = this.running.get(id);
          this.running.delete(id);
          const played = run ? Date.now() - run.startedAt : 0;
          this.updateInstance(id, { playTimeMs: (this.instance(id).playTimeMs || 0) + played });
          this.send('game:exit', { id, ...result });
          if (parentWindow && !parentWindow.isDestroyed() && settings.afterLaunch === 'minimize') parentWindow.restore();
        },
      });
      this.running.set(id, { child, startedAt: Date.now() });
      this.updateInstance(id, { lastPlayed: Date.now() });
      const startLines = [{ time: Date.now(), level: 'INFO', thread: 'launcher', text: tr('Command: {cmd}', { cmd: commandLine.join(' ') }) }];
      if (qp?.singleplayer) startLines.push({ time: Date.now(), level: 'INFO', thread: 'launcher', text: tr('Starting straight in the world “{world}”.', { world: qp.singleplayer }) });
      if (qp?.multiplayer) startLines.push({ time: Date.now(), level: 'INFO', thread: 'launcher', text: tr('Joining the server {server} directly.', { server: qp.multiplayer }) });
      if (qp?.missing) startLines.push({ time: Date.now(), level: 'WARN', thread: 'launcher', text: tr('The world “{world}” no longer exists, so the game starts at the title screen.', { world: qp.missing }) });
      this.send('game:log', { id, lines: startLines });
      this.send('game:started', { id, pid: child.pid });
      if (parentWindow && !parentWindow.isDestroyed() && settings.afterLaunch === 'minimize') parentWindow.minimize();
      return { pid: child.pid };
    } finally {
      this.preparing.delete(id);
    }
  }

  cancel(id) {
    const abort = this.preparing.get(id);
    if (abort) abort.abort(Object.assign(new Error(tr('Cancelled')), { code: 'cancelled' }));
    return !!abort;
  }

  kill(id) {
    const run = this.running.get(id);
    if (!run) return false;
    run.child.kill();
    return true;
  }

  // ------------------------------------------------------------- mods

  modsDir(id) {
    this.instance(id);
    return path.join(this.layout.instanceDir(id), 'mods');
  }

  listMods(id) {
    return mods.listMods(this.modsDir(id));
  }

  async toggleMod(id, file, enabled) {
    return mods.setEnabled(this.modsDir(id), file, enabled);
  }

  async removeMod(id, file) {
    const p = mods.modPath(this.modsDir(id), file);
    await shell.trashItem(p);
    await modrinth.forget(this.modsDir(id), file);
    return true;
  }

  async addModFiles(id, files) {
    const valid = [];
    for (const f of files) {
      if (typeof f !== 'string' || !/\.jar$/i.test(f)) continue;
      const st = await fsp.stat(f).catch(() => null);
      if (st?.isFile()) valid.push(f);
    }
    return mods.addFiles(this.modsDir(id), valid);
  }

  /** One page of Modrinth results, each marked with whether it is already in this instance. */
  async searchMods(id, query, offset = 0) {
    const inst = this.instance(id);
    const modsDir = this.modsDir(id);
    const [res, installed] = await Promise.all([
      modrinth.search({ query: String(query || '').slice(0, 100), gameVersion: inst.version, loader: 'fabric', offset: Math.max(0, offset | 0) }),
      mods.listMods(modsDir).then((list) => modrinth.installedIndex(modsDir, list)),
    ]);
    return { ...res, hits: res.hits.map((h) => ({ ...h, installed: modrinth.isInstalled(h, installed) })) };
  }

  installMod(id, projectId) {
    const inst = this.instance(id);
    if (inst.loader.type !== 'fabric') throw new Error(tr('The instance has no Fabric. Mods need a loader.'));
    if (!/^[A-Za-z0-9]{6,12}$/.test(projectId)) throw new Error('Invalid Modrinth project');
    return modrinth.install(this.modsDir(id), projectId, { gameVersion: inst.version, loader: 'fabric' });
  }

  /** Newer Modrinth versions of the mods in this instance (kept so applyModUpdates can use them). */
  async checkModUpdates(id) {
    const inst = this.instance(id);
    const modsDir = this.modsDir(id);
    const updates = await modrinth.checkUpdates(modsDir, await mods.listMods(modsDir), { gameVersion: inst.version, loader: 'fabric' });
    this.updateCache.set(id, updates);
    return updates.map(({ version, ...u }) => u);
  }

  /** Updates the given files (all checked ones when files is empty). Old jars go to the Recycle Bin. */
  async applyModUpdates(id, files = []) {
    const modsDir = this.modsDir(id);
    const pending = (this.updateCache.get(id) || []).filter((u) => !files.length || files.includes(u.file));
    const done = [];
    const failed = [];
    for (const u of pending) {
      try {
        const file = await modrinth.applyUpdate(modsDir, u, { removeOld: (p) => shell.trashItem(p).catch(() => fsp.rm(p, { force: true })) });
        done.push({ name: u.name, from: u.current, to: u.latest, file });
      } catch (err) {
        failed.push({ name: u.name, error: err.message });
      }
    }
    this.updateCache.set(id, (this.updateCache.get(id) || []).filter((u) => !pending.includes(u)));
    return { done, failed };
  }

  // ------------------------------------------------------------- quick play, screenshots

  async quickPlayOptions(id) {
    const dir = this.layout.instanceDir(this.instance(id).id);
    const [worlds, servers] = await Promise.all([quickplay.listWorlds(dir), quickplay.listServers(dir)]);
    return { worlds, servers };
  }

  /** Absolute path of a file inside one instance folder, refusing anything that escapes it. */
  instanceFile(id, ...parts) {
    const base = path.join(this.layout.instanceDir(this.instance(id).id), parts[0]);
    const file = path.resolve(base, ...parts.slice(1));
    if (!file.startsWith(base + path.sep)) throw new Error('Path not allowed');
    return file;
  }

  /** Screenshots of every instance (or one), newest first. */
  async listScreenshots(id = null) {
    const insts = this.instances.get().instances.filter((i) => !id || i.id === id);
    const out = [];
    for (const inst of insts) {
      const dir = path.join(this.layout.instanceDir(inst.id), 'screenshots');
      let names = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const file of names) {
        if (!/\.(png|jpe?g)$/i.test(file)) continue;
        const st = await fsp.stat(path.join(dir, file)).catch(() => null);
        if (st?.isFile()) out.push({ instance: inst.id, instanceName: inst.name, file, size: st.size, time: st.mtimeMs });
      }
    }
    return out.sort((a, b) => b.time - a.time).slice(0, 500);
  }

  async deleteScreenshot(id, file) {
    await shell.trashItem(this.instanceFile(id, 'screenshots', file));
    return true;
  }

  // ------------------------------------------------------------- java

  async testJava(file) {
    const probe = await probeJava(file);
    return probe ? { ok: true, major: probe.major, raw: probe.raw } : { ok: false };
  }
}

module.exports = { Launcher };

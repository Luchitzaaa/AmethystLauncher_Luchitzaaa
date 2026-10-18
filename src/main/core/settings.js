'use strict';

const os = require('node:os');

const AFTER_LAUNCH = ['minimize', 'keep'];
const LANGUAGES = ['en', 'ro'];

function totalMemoryMB() {
  return Math.floor(os.totalmem() / 1024 / 1024);
}

/** Sensible default heap: a quarter of RAM, between 2 and 6 GB. */
function defaultMaxMemory() {
  return Math.min(6144, Math.max(2048, Math.round(totalMemoryMB() / 4 / 512) * 512));
}

const DEFAULTS = {
  version: 1,
  language: 'en',
  memory: { min: 1024, max: defaultMaxMemory() },
  javaPath: '',
  jvmArgs: [],
  afterLaunch: 'minimize',
  reducedMotion: false,
  showSnapshots: false,
  azureClientId: '',
  selectedInstance: 'default',
};

const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** Splits a user-typed JVM argument line; quoted parts keep their spaces. */
function parseArgs(text) {
  if (Array.isArray(text)) return text.filter((a) => typeof a === 'string' && a.length > 0 && a.length < 1000).slice(0, 64);
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1] ?? m[2]);
  return out.slice(0, 64);
}

function sanitizeSettings(input) {
  const i = input && typeof input === 'object' ? input : {};
  const maxMem = Math.max(512, totalMemoryMB() - 512);
  const max = int(i.memory?.max, 512, maxMem, DEFAULTS.memory.max);
  return {
    version: 1,
    // English unless Romanian was chosen (also for settings saved by v1–v3, which had no language).
    language: LANGUAGES.includes(i.language) ? i.language : DEFAULTS.language,
    memory: { min: int(i.memory?.min, 256, max, Math.min(1024, max)), max },
    javaPath: typeof i.javaPath === 'string' ? i.javaPath.trim() : '',
    jvmArgs: parseArgs(i.jvmArgs),
    afterLaunch: AFTER_LAUNCH.includes(i.afterLaunch) ? i.afterLaunch : DEFAULTS.afterLaunch,
    reducedMotion: !!i.reducedMotion,
    showSnapshots: !!i.showSnapshots,
    azureClientId: typeof i.azureClientId === 'string' && /^[0-9a-f-]{0,64}$/i.test(i.azureClientId.trim()) ? i.azureClientId.trim() : '',
    selectedInstance: typeof i.selectedInstance === 'string' ? i.selectedInstance : DEFAULTS.selectedInstance,
  };
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const COLORS = ['#A78BFA', '#F472B6', '#38BDF8', '#34D399', '#FBBF24', '#F87171'];

function slugify(name) {
  const base = String(name || 'instance')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'instance';
}

/** Where the game starts: the title screen, straight into a singleplayer world, or onto a server. */
function sanitizeQuickPlay(q) {
  if (q?.type === 'world' && typeof q.target === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,128}$/.test(q.target) && !/^\.+$/.test(q.target)) {
    // The world's own name (from level.dat) is kept for display; the folder is what the game needs.
    const label = typeof q.label === 'string' ? q.label.replace(/[\x00-\x1f]/g, '').trim().slice(0, 64) : '';
    return label && label !== q.target ? { type: 'world', target: q.target, label } : { type: 'world', target: q.target };
  }
  if (q?.type === 'server' && typeof q.target === 'string' && /^[A-Za-z0-9.\-_\[\]:]{1,255}$/.test(q.target.trim())) {
    return { type: 'server', target: q.target.trim() };
  }
  return { type: 'menu', target: '' };
}

function sanitizeInstance(i, existingIds = new Set()) {
  const name = String(i?.name || 'New instance').trim().slice(0, 48) || 'New instance';
  let id = typeof i?.id === 'string' && ID_RE.test(i.id) ? i.id : null;
  if (!id) {
    const base = slugify(name);
    id = base;
    for (let n = 2; existingIds.has(id); n++) id = `${base}-${n}`;
  }
  const loaderType = i?.loader?.type === 'fabric' ? 'fabric' : 'vanilla';
  const version = typeof i?.version === 'string' && /^[\w.\-+ ]{1,64}$/.test(i.version) ? i.version : '26.3';
  const out = {
    id,
    name,
    version,
    loader: { type: loaderType, version: loaderType === 'fabric' ? (typeof i?.loader?.version === 'string' && i.loader.version ? i.loader.version : 'latest') : null },
    color: COLORS.includes(i?.color) ? i.color : COLORS[Math.abs(hash(id)) % COLORS.length],
    created: Number.isFinite(i?.created) ? i.created : Date.now(),
    lastPlayed: Number.isFinite(i?.lastPlayed) ? i.lastPlayed : 0,
    playTimeMs: Number.isFinite(i?.playTimeMs) ? i.playTimeMs : 0,
    quickPlay: sanitizeQuickPlay(i?.quickPlay),
  };
  if (i?.memory && Number.isFinite(i.memory.max)) out.memory = { min: int(i.memory.min, 256, i.memory.max, 1024), max: int(i.memory.max, 512, 65536, 4096) };
  if (i?.resolution && Number.isFinite(i.resolution.width)) {
    out.resolution = { width: int(i.resolution.width, 320, 7680, 1280), height: int(i.resolution.height, 240, 4320, 720) };
  }
  if (typeof i?.javaPath === 'string' && i.javaPath.trim()) out.javaPath = i.javaPath.trim();
  if (i?.jvmArgs) out.jvmArgs = parseArgs(i.jvmArgs);
  return out;
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

const DEFAULT_INSTANCE = { id: 'default', name: 'Amethyst 26.3', version: '26.3', loader: { type: 'fabric', version: 'latest' }, color: '#A78BFA' };

module.exports = { DEFAULTS, DEFAULT_INSTANCE, AFTER_LAUNCH, LANGUAGES, totalMemoryMB, sanitizeSettings, sanitizeInstance, sanitizeQuickPlay, parseArgs, slugify };

// Shared renderer state with tiny pub/sub. Pages subscribe on mount and unsubscribe on unmount.

const api = window.amethyst;
const listeners = new Map();
const MAX_LOG = 4000;

export const state = {
  info: null,
  settings: null,
  instances: [],
  accounts: [],
  progress: new Map(), // instanceId → last progress event
  running: new Set(),
  logs: [], // {time, level, thread, text, instance}
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

export async function refreshInstances() {
  state.instances = await api.instances.list();
  state.running = new Set(state.instances.filter((i) => i.running).map((i) => i.id));
  emit('instances', state.instances);
  return state.instances;
}

export async function refreshAccounts() {
  state.accounts = await api.accounts.list();
  emit('accounts', state.accounts);
  return state.accounts;
}

export async function saveSettings(patch) {
  state.settings = await api.settings.set(patch);
  emit('settings', state.settings);
  return state.settings;
}

export function selectedInstance() {
  return state.instances.find((i) => i.id === state.settings?.selectedInstance) || state.instances[0] || null;
}

export async function selectInstance(id) {
  await saveSettings({ selectedInstance: id });
  emit('selected', selectedInstance());
}

export async function init() {
  [state.info, state.settings] = await Promise.all([api.app.info(), api.settings.get()]);
  await Promise.all([refreshInstances(), refreshAccounts()]);

  api.launch.onProgress((p) => {
    state.progress.set(p.id, p);
    emit('progress', p);
  });
  api.launch.onStarted((p) => {
    state.progress.delete(p.id);
    state.running.add(p.id);
    emit('running', p);
  });
  api.launch.onExit((p) => {
    state.running.delete(p.id);
    state.progress.delete(p.id);
    emit('exit', p);
    refreshInstances();
  });
  api.launch.onLog(({ id, lines }) => {
    for (const l of lines) state.logs.push({ ...l, instance: id });
    if (state.logs.length > MAX_LOG) state.logs.splice(0, state.logs.length - MAX_LOG);
    emit('log', { id, lines });
  });
}

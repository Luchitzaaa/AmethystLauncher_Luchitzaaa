import { h, icon, toggle, slider, segmented, toast, toastError } from '../ui.js';
import { state, saveSettings } from '../state.js';
import { t, LANGUAGES } from '../i18n.js';

const api = window.amethyst;

const SECTIONS = [
  { id: 'general', label: () => t('General'), icon: 'sliders' },
  { id: 'java', label: () => t('Java & memory'), icon: 'cpu' },
  { id: 'account', label: () => t('Accounts'), icon: 'shield' },
];
// Remembered so a language switch (which re-renders the page) stays on the same section.
let lastSection = 'general';

function setting(title, desc, control) {
  return h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('div', { class: 't' }, ...[].concat(title)), desc ? h('div', { class: 'd' }, desc) : null), control);
}

function debounce(fn, ms) {
  let timer = 0;
  return (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
}

// ───────────────────────── General
function general(box) {
  const s = state.settings;
  const langPick = h('div', { class: 'lang-pick', role: 'radiogroup', 'aria-label': t('Language') },
    ...LANGUAGES.map((l) => h('button', {
      type: 'button', class: `lang-opt${s.language === l.value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(s.language === l.value), dataset: { lang: l.value },
      onclick: () => {
        if (state.settings.language !== l.value) saveSettings({ language: l.value }).catch(toastError);
      },
    }, h('span', { class: `flag flag-${l.value}` }), l.label)),
  );
  box.append(
    h('div', { class: 'card pad' },
      h('div', { class: 'card-title' }, icon('language'), t('Language')),
      setting(t('Launcher language'), t('English is the default.'), langPick),
    ),
    h('div', { class: 'card pad' },
      h('div', { class: 'card-title' }, 'Launcher'),
      setting(t('After the game starts'), t('What the launcher does when Minecraft starts.'), segmented(
        [{ label: t('Minimize'), value: 'minimize' }, { label: t('Stay open'), value: 'keep' }], s.afterLaunch, (v) => saveSettings({ afterLaunch: v }),
      )),
      setting(t('Reduced motion'), t('Stops the animated background and most animations (uses less power).'), toggle(s.reducedMotion, (v) => saveSettings({ reducedMotion: v }), t('Reduced motion'))),
      setting(t('Show snapshots'), t('Include test versions in the version list.'), toggle(s.showSnapshots, (v) => saveSettings({ showSnapshots: v }), t('Snapshots'))),
      setting(t('Launcher folder'), state.info.dataDir, h('button', { class: 'btn sm', type: 'button', onclick: () => api.app.open('data').catch(toastError) }, icon('folder'), t('Open'))),
    ),
  );
}

// ───────────────────────── Java & memory
function java(box) {
  const s = state.settings;
  const maxMem = Math.max(2048, Math.floor(state.info.totalMemoryMB / 512) * 512 - 1024);
  const save = debounce((patch) => saveSettings(patch).catch(toastError), 250);
  const auto = () => t('Automatic: official Mojang Java (downloaded when needed)');
  const javaLabel = h('span', { class: 'mono hint' }, s.javaPath || auto());
  const args = h('input', { class: 'input mono', value: s.jvmArgs.join(' '), placeholder: t('e.g. -XX:+UseZGC') });
  args.addEventListener('change', () => saveSettings({ jvmArgs: args.value }).then(() => toast('success', t('Arguments saved'))).catch(toastError));
  box.append(
    h('div', { class: 'card pad' },
      h('div', { class: 'card-title' }, t('Memory')),
      slider({
        name: t('Maximum memory (RAM)'), min: 1024, max: maxMem, step: 512, value: Math.min(s.memory.max, maxMem),
        format: (v) => `${(v / 1024).toFixed(1)} GB`,
        describe: (v) => t('{pct}% of {total} GB. For 26.3 with mods, 4–6 GB is a good balance.', { pct: Math.round((v / state.info.totalMemoryMB) * 100), total: (state.info.totalMemoryMB / 1024).toFixed(0) }),
        onInput: (v) => save({ memory: { max: v } }),
      }),
    ),
    h('div', { class: 'card pad' },
      h('div', { class: 'card-title' }, 'Java'),
      setting(t('Java executable'), javaLabel, h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          const res = await api.java.pick().catch(toastError);
          if (!res) return;
          if (!res.ok) {
            toast('error', t('Not a valid Java'), res.path);
            return;
          }
          await saveSettings({ javaPath: res.path });
          javaLabel.textContent = `${res.path} (Java ${res.major})`;
          toast('success', t('Java {major} set', { major: res.major }), res.raw);
        } }, t('Choose…')),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          await saveSettings({ javaPath: '' });
          javaLabel.textContent = auto();
        } }, t('Automatic')),
      )),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', {}, t('Extra JVM arguments')), args,
        h('div', { class: 'hint' }, t('The launcher already uses the G1GC settings Mojang recommends. Only add what you know you need.'))),
    ),
  );
}

// ───────────────────────── Account / Azure
function account(box, { openAccounts }) {
  const s = state.settings;
  const input = h('input', { class: 'input mono', value: s.azureClientId, placeholder: '00000000-0000-0000-0000-000000000000', maxlength: 64 });
  input.addEventListener('change', async () => {
    try {
      const next = await saveSettings({ azureClientId: input.value.trim() });
      if (input.value.trim() && !next.azureClientId) toast('error', t('Invalid ID'), t('An Application (client) ID looks like a GUID.'));
      else toast('success', t('ID saved'));
    } catch (err) {
      toastError(err);
    }
  });
  box.append(
    h('div', { class: 'card pad' },
      h('div', { class: 'card-title' }, icon('shield'), t('Microsoft sign-in')),
      h('p', { class: 'muted' }, t('The launcher uses the official Microsoft flow (OAuth 2.0 with PKCE) → Xbox Live → Minecraft Services and checks online that you own the game. For that it needs the ID of an Azure application you registered.')),
      h('div', { class: 'field' }, h('label', {}, 'Azure Application (client) ID'), input,
        h('div', { class: 'hint' }, t('Redirect URI to add in Azure (Mobile and desktop applications): {uri}', { uri: 'https://login.microsoftonline.com/common/oauth2/nativeclient' }))),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => openAccounts() }, icon('user'), t('Accounts')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => api.app.external('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade').catch(toastError) }, icon('external'), t('Azure portal')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => api.app.external('https://aka.ms/mce-reviewappid').catch(toastError) }, icon('external'), t('Request Minecraft API approval')),
      ),
      h('p', { class: 'hint', style: { marginTop: '12px' } }, t('New Azure applications must be approved once by Mojang for the Minecraft API. Until then sign-in stops at the last step with “403”. The full steps are in the README.')),
    ),
  );
}

export default {
  mount(root, ctx) {
    let section = ctx.params?.section || lastSection;
    let cleanup = null;
    const nav = h('div', { class: 'card opt-nav' });
    const panel = h('div', {});
    const paintNav = () => nav.replaceChildren(...SECTIONS.map((s) => h('button', {
      type: 'button', class: s.id === section ? 'on' : '', dataset: { section: s.id },
      onclick: () => { section = s.id; lastSection = s.id; paintNav(); show(); },
    }, icon(s.icon), s.label())));

    function show() {
      cleanup?.();
      cleanup = null;
      lastSection = section;
      const box = h('div', { class: 'opt-section' });
      panel.replaceChildren(box);
      if (section === 'general') general(box);
      else if (section === 'java') java(box);
      else account(box, ctx);
    }

    root.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, t('Options')), h('p', { class: 'page-sub' }, t('Launcher settings.')))),
      h('div', { class: 'opt-layout' }, nav, panel),
    );
    paintNav();
    show();
    return () => cleanup?.();
  },
};

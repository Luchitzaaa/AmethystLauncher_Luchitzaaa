import { h, icon, gem, modal, confirmDialog, toast, toastError, segmented, slider, timeAgo, toggle } from '../ui.js';
import { state, on, refreshInstances, selectInstance, selectedInstance } from '../state.js';
import { tilt } from '../fx/motion.js';
import { t } from '../i18n.js';

const api = window.amethyst;
const COLORS = ['#A78BFA', '#F472B6', '#38BDF8', '#34D399', '#FBBF24', '#F87171'];
let versionCache = null;

async function loadVersions() {
  if (!versionCache) versionCache = await api.versions.list();
  return versionCache;
}

/** Create or edit an instance. */
export function instanceEditor(existing, onSaved) {
  const data = existing
    ? structuredClone(existing)
    : { name: '', version: '26.3', loader: { type: 'fabric', version: 'latest' }, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  modal((box, close) => {
    const name = h('input', { class: 'input', value: data.name, placeholder: t('e.g. Survival with friends'), maxlength: 48 });
    const swatches = h('div', { class: 'swatches' });
    const paintSwatches = () => swatches.replaceChildren(...COLORS.map((c) => h('button', {
      type: 'button', class: c === data.color ? 'on' : '', 'aria-label': c, style: { background: c },
      onclick: () => { data.color = c; paintSwatches(); },
    })));
    paintSwatches();

    const filter = h('input', { class: 'input', placeholder: t('Search version…') });
    const list = h('div', { class: 'version-list' }, h('div', { class: 'skeleton', style: { height: '180px', margin: '8px' } }));
    const loaderVersion = h('select', { class: 'select' });
    const loaderField = h('div', { class: 'field' }, h('label', {}, t('Fabric Loader version')), loaderVersion);
    let versions = [];

    const paintList = () => {
      const q = filter.value.trim();
      const items = versions.filter((v) => !q || v.id.includes(q)).slice(0, 200);
      list.replaceChildren(...items.map((v) => h('button', {
        type: 'button', class: v.id === data.version ? 'on' : '',
        onclick: () => { data.version = v.id; paintList(); loadLoaders(); },
      }, h('span', {}, v.id), h('span', { class: 'row' },
        v.fabric ? h('span', { class: 'chip', style: { height: '20px' } }, 'Fabric') : null,
        v.type === 'snapshot' ? h('span', { class: 'chip warn', style: { height: '20px' } }, 'snapshot') : null,
      ))));
      if (!items.length) list.append(h('div', { class: 'empty' }, t('No version found.')));
    };
    filter.addEventListener('input', paintList);

    async function loadLoaders() {
      if (data.loader.type !== 'fabric') {
        loaderField.classList.add('hidden');
        return;
      }
      loaderField.classList.remove('hidden');
      loaderVersion.replaceChildren(h('option', { value: 'latest' }, t('Latest stable (recommended)')));
      try {
        const lv = await api.versions.fabricLoaders(data.version);
        for (const l of lv.slice(0, 30)) loaderVersion.append(h('option', { value: l.version }, `${l.version}${l.stable ? '' : ' (beta)'}`));
        if (!lv.length) toast('info', t('Fabric does not support this version yet'), data.version);
      } catch {
        /* offline: "latest" still works once online */
      }
      loaderVersion.value = data.loader.version || 'latest';
      if (loaderVersion.value !== (data.loader.version || 'latest')) loaderVersion.value = 'latest';
    }
    loaderVersion.addEventListener('change', () => { data.loader.version = loaderVersion.value; });

    const memOverride = !!existing?.memory;
    let mem = existing?.memory?.max ?? state.settings.memory.max;
    const memSlider = slider({
      name: t('Maximum memory for this instance'),
      min: 1024, max: Math.max(2048, Math.floor(state.info.totalMemoryMB / 512) * 512 - 1024), step: 512, value: mem,
      format: (v) => `${(v / 1024).toFixed(1)} GB`,
      onInput: (v) => { mem = v; },
    });
    let useMem = memOverride;
    memSlider.classList.toggle('hidden', !useMem);

    const save = h('button', { class: 'btn primary', type: 'button' }, existing ? t('Save') : t('Create instance'));
    save.addEventListener('click', async () => {
      data.name = name.value.trim() || `Minecraft ${data.version}`;
      const payload = { name: data.name, version: data.version, loader: data.loader, color: data.color };
      payload.memory = useMem ? { min: 1024, max: mem } : null;
      save.disabled = true;
      try {
        const saved = existing ? await api.instances.update(existing.id, payload) : await api.instances.create(payload);
        await refreshInstances();
        toast('success', existing ? t('Instance saved') : t('Instance created'), saved.name);
        close(saved);
        onSaved?.(saved);
      } catch (err) {
        toastError(err);
        save.disabled = false;
      }
    });

    box.append(
      h('h2', {}, existing ? t('Edit instance') : t('New instance')),
      h('p', { class: 'muted' }, t('Every instance has its own folder: separate mods, worlds, settings and resource packs.')),
      h('div', { class: 'field' }, h('label', {}, t('Name')), name),
      h('div', { class: 'field' }, h('label', {}, t('Color')), swatches),
      h('div', { class: 'field' }, h('label', {}, 'Loader'), segmented([{ label: 'Fabric', value: 'fabric' }, { label: 'Vanilla', value: 'vanilla' }], data.loader.type, (v) => {
        data.loader = { type: v, version: v === 'fabric' ? 'latest' : null };
        loadLoaders();
      })),
      h('div', { class: 'field' }, h('label', {}, t('Minecraft version')), filter, list),
      loaderField,
      h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('div', { class: 't' }, t('Own memory setting')), h('div', { class: 'd' }, t('Otherwise the value from Options is used.'))),
        toggle(useMem, (v) => { useMem = v; memSlider.classList.toggle('hidden', !v); }, t('Own memory setting'))),
      memSlider,
      h('div', { class: 'foot' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, t('Cancel')), save),
    );

    loadVersions().then((v) => {
      versions = v.versions;
      if (!versions.some((x) => x.id === data.version) && v.latest?.release) data.version = existing ? data.version : v.latest.release;
      paintList();
      list.querySelector('.on')?.scrollIntoView({ block: 'center' });
    }).catch((err) => {
      list.replaceChildren(h('div', { class: 'empty' }, t('Cannot load the version list (offline?).')));
      toastError(err);
    });
    loadLoaders();
  });
}

export default {
  mount(root, { navigate }) {
    const grid = h('div', { class: 'inst-grid stagger' });
    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { class: 'page-title' }, t('Instances')), h('p', { class: 'page-sub' }, t('Separate game profiles. Pick one for Home or create a new one.'))),
        h('button', { class: 'btn primary', type: 'button', dataset: { action: 'new-instance' }, onclick: () => instanceEditor(null) }, icon('plus'), t('New instance')),
      ),
      grid,
    );

    function render() {
      const sel = selectedInstance();
      grid.replaceChildren(...state.instances.map((inst, i) => {
        const card = h('div', { class: `card inst-card${inst.id === sel?.id ? ' selected' : ''}`, vars: { '--i': i }, tabindex: 0 },
          gem(inst.color),
          h('div', { class: 'name' }, inst.name),
          h('div', { class: 'meta' },
            h('span', { class: 'chip accent' }, inst.version),
            h('span', { class: 'chip' }, inst.loader.type === 'fabric' ? 'Fabric' : 'Vanilla'),
            inst.running ? h('span', { class: 'chip good' }, h('span', { class: 'dot pulse' }), t('running')) : null,
          ),
          h('div', { class: 'hint', style: { marginTop: '10px' } }, t('Played {ago}', { ago: timeAgo(inst.lastPlayed) })),
          h('div', { class: 'actions' },
            h('button', { class: 'btn sm', type: 'button', title: t('Edit'), onclick: (e) => { e.stopPropagation(); instanceEditor(inst); } }, icon('edit')),
            h('button', { class: 'btn sm', type: 'button', title: t('Open folder'), onclick: (e) => { e.stopPropagation(); api.app.open(`instance:${inst.id}`).catch(toastError); } }, icon('folder')),
            h('button', { class: 'btn sm', type: 'button', title: t('Mods'), onclick: (e) => { e.stopPropagation(); selectInstance(inst.id).then(() => navigate('mods')); } }, icon('cube')),
            h('button', { class: 'btn sm', type: 'button', title: t('Screenshots'), onclick: (e) => { e.stopPropagation(); navigate('gallery', { instance: inst.id }); } }, icon('image')),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn sm danger', type: 'button', title: t('Delete'), onclick: (e) => { e.stopPropagation(); remove(inst); } }, icon('trash')),
          ),
        );
        card.addEventListener('click', async () => {
          await selectInstance(inst.id);
          navigate('home');
        });
        tilt(card, { max: 9, lift: 3 });
        return card;
      }), (() => {
        const add = h('button', { class: 'card inst-card add', type: 'button', vars: { '--i': state.instances.length }, onclick: () => instanceEditor(null) }, icon('plus'), h('span', {}, t('Create an instance')));
        return add;
      })());
    }

    async function remove(inst) {
      let alsoFiles = false;
      const ok = await confirmDialog(t('Delete “{name}”?', { name: inst.name }), t('The instance disappears from the list.'), {
        okText: t('Delete'), danger: true,
        extra: h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('div', { class: 't' }, t('Also move the folder to the Recycle Bin')), h('div', { class: 'd' }, t('Worlds, mods and settings. They can be restored from the Recycle Bin.'))), toggle(false, (v) => { alsoFiles = v; }, t('Delete the files'))),
      });
      if (!ok) return;
      try {
        await api.instances.remove(inst.id, { deleteFiles: alsoFiles });
        await refreshInstances();
        state.settings = await api.settings.get();
        toast('success', t('Instance deleted'), inst.name);
      } catch (err) {
        toastError(err);
      }
    }

    const off = on('instances', render);
    render();
    return off;
  },
};

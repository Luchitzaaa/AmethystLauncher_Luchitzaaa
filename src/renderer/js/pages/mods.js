import { h, icon, toast, toastError, toggle, segmented, formatBytes, formatCount, confirmDialog } from '../ui.js';
import { state, selectedInstance, selectInstance } from '../state.js';
import { t } from '../i18n.js';

const api = window.amethyst;

function modIcon(src) {
  const box = h('div', { class: 'mod-icon' });
  if (src) {
    const img = h('img', { src, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(icon('cube')));
    box.append(img);
  } else {
    box.append(icon('cube'));
  }
  return box;
}

export default {
  mount(root) {
    let tab = 'installed';
    let inst = selectedInstance();
    let disposed = false;
    const updates = new Map(); // instanceId → result of the last update check

    const picker = h('select', { class: 'select', style: { width: '240px' } });
    const body = h('div', {});
    const drop = h('div', { class: 'dropzone' }, h('div', { class: 'box' }, icon('download'), h('div', {}, t('Drop the .jar files here')), h('div', { class: 'hint' }, t('They are copied into the mods folder of the instance'))));
    document.body.append(drop);

    const fillPicker = () => {
      picker.replaceChildren(...state.instances.map((i) => h('option', { value: i.id, selected: i.id === inst?.id }, `${i.name} · ${i.version}${i.loader.type === 'fabric' ? ' · Fabric' : ''}`)));
    };
    fillPicker();
    picker.addEventListener('change', async () => {
      await selectInstance(picker.value);
      inst = selectedInstance();
      render();
    });

    const tabs = segmented([{ label: t('Installed mods'), value: 'installed' }, { label: t('Discover on Modrinth'), value: 'discover' }], tab, (v) => {
      tab = v;
      render();
    });

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { class: 'page-title' }, t('Mods')), h('p', { class: 'page-sub' }, t('Manage the Fabric mods of each instance. Drop .jar files anywhere in the window.'))),
        h('div', { class: 'row' }, picker),
      ),
      h('div', { class: 'toolbar' }, tabs, h('span', { class: 'grow' }),
        h('button', { class: 'btn sm', type: 'button', onclick: () => api.app.open(`mods:${inst.id}`).catch(toastError) }, icon('folder'), t('Folder')),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { const added = await api.mods.pick(inst.id).catch(toastError); if (added?.length) { toast('success', t('Mods added'), added.join(', ')); render(); } } }, icon('plus'), t('Add files')),
      ),
      body,
    );

    async function renderInstalled() {
      body.replaceChildren(h('div', { class: 'mod-list' }, ...[0, 1, 2].map(() => h('div', { class: 'skeleton', style: { height: '64px' } }))));
      let list;
      try {
        list = await api.mods.list(inst.id);
      } catch (err) {
        toastError(err);
        return;
      }
      if (disposed || tab !== 'installed') return;
      if (inst.loader.type !== 'fabric') {
        body.replaceChildren(h('div', { class: 'card pad empty' }, icon('cube'), t('The instance is Vanilla. Create or edit an instance with Fabric to use mods.')));
        return;
      }
      if (!list.length) {
        body.replaceChildren(h('div', { class: 'card pad empty' }, icon('cube'), t('No mods installed. Search Modrinth or drop .jar files here.')));
        return;
      }
      const enabled = list.filter((m) => m.enabled).length;
      const instanceId = inst.id;
      const pending = updates.get(instanceId); // last update check for this instance, if any
      const updateBar = h('div', { class: 'row update-bar' });
      const paintUpdateBar = () => {
        const u = updates.get(instanceId);
        const count = !u ? null : !u.length ? t('All up to date') : u.length === 1 ? t('1 update') : t('{n} updates', { n: u.length });
        // (Filtered: DOM replaceChildren would print a null child as the text "null".)
        updateBar.replaceChildren(...[
          h('span', { class: 'hint grow' }, t('{n} mods · {m} enabled', { n: list.length, m: enabled }), count ? h('span', { class: u.length ? 'chip warn upd-count' : 'chip good upd-count' }, count) : null),
          u?.length ? h('button', { class: 'btn sm primary', type: 'button', dataset: { action: 'update-all' }, onclick: () => runUpdates([]) }, icon('upgrade'), t('Update all')) : null,
          h('button', { class: 'btn sm', type: 'button', dataset: { action: 'check-updates' }, onclick: checkUpdates }, icon('refresh'), t('Check for updates')),
        ].filter(Boolean));
      };
      const checkUpdates = async (e) => {
        const btn = e?.currentTarget;
        if (btn) {
          btn.disabled = true;
          btn.replaceChildren(h('span', { class: 'spinner sm' }), t('Checking…'));
        }
        try {
          const u = await api.mods.updates(instanceId);
          updates.set(instanceId, u);
          if (!u.length) toast('success', t('All mods are up to date'), t('Checked {n} mods on Modrinth.', { n: list.length }));
          renderInstalled();
        } catch (err) {
          toastError(err, t('Modrinth did not answer'));
          paintUpdateBar();
        }
      };
      const runUpdates = async (files) => {
        updateBar.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          const res = await api.mods.applyUpdates(instanceId, files);
          const left = (updates.get(instanceId) || []).filter((x) => !res.done.some((d) => d.name === x.name));
          updates.set(instanceId, left);
          if (res.done.length) toast('success', res.done.length === 1 ? t('1 mod updated') : t('{n} mods updated', { n: res.done.length }), res.done.map((d) => `${d.name} ${d.from} → ${d.to}`).join(', '), 7000);
          if (res.failed.length) toast('error', res.failed.length === 1 ? t('1 update failed') : t('{n} updates failed', { n: res.failed.length }), res.failed.map((f) => `${f.name}: ${f.error}`).join(' · '), 9000);
        } catch (err) {
          toastError(err);
        }
        renderInstalled();
      };
      paintUpdateBar();
      body.replaceChildren(
        updateBar,
        h('div', { class: 'mod-list stagger' }, ...list.map((m, i) => {
          const upd = pending?.find((u) => u.file === m.file);
          const row = h('div', { class: `card mod-row${m.enabled ? '' : ' off'}`, vars: { '--i': Math.min(i, 12) } },
            modIcon(m.icon),
            h('div', { class: 'grow' },
              h('div', { class: 'row' }, h('span', { class: 'mod-name' }, m.name), m.version ? h('span', { class: 'chip', style: { height: '20px' } }, m.version) : null,
                upd ? h('span', { class: 'chip warn upd-chip', style: { height: '20px' } }, icon('upgrade'), upd.latest) : null),
              h('div', { class: 'mod-desc' }, m.description || m.file),
            ),
            h('span', { class: 'hint' }, formatBytes(m.size)),
            upd ? h('button', { class: 'btn sm', type: 'button', title: t('Update to {version}', { version: upd.latest }), onclick: () => runUpdates([m.file]) }, icon('upgrade'), t('Update')) : null,
            toggle(m.enabled, async (on) => {
              try {
                await api.mods.toggle(inst.id, m.file, on);
                row.classList.toggle('off', !on);
                renderInstalled();
              } catch (err) {
                toastError(err);
              }
            }, t('Enable {name}', { name: m.name })),
            h('button', { class: 'btn sm icon danger', type: 'button', title: t('Move to the Recycle Bin'), onclick: async () => {
              if (!(await confirmDialog(t('Remove {name}?', { name: m.name }), t('The file goes to the Recycle Bin.'), { okText: t('Remove'), danger: true }))) return;
              try {
                await api.mods.remove(inst.id, m.file);
                toast('success', t('Mod removed'), m.name);
                renderInstalled();
              } catch (err) {
                toastError(err);
              }
            } }, icon('trash')),
          );
          return row;
        })),
      );
    }

    let observer = null;
    function renderDiscover() {
      observer?.disconnect();
      const q = h('input', { class: 'input', placeholder: t('Search mods for {version}… (empty = most popular)', { version: inst.version }), style: { maxWidth: '420px' } });
      const results = h('div', { class: 'search-results' });
      const sentinel = h('div', { class: 'load-more' });
      const countLbl = h('span', { class: 'hint' });
      body.replaceChildren(h('div', { class: 'toolbar' }, icon('search'), q, h('span', { class: 'grow' }), countLbl), results, sentinel);
      if (inst.loader.type !== 'fabric') {
        results.replaceChildren(h('div', { class: 'card pad empty' }, t('Mods need a Fabric instance.')));
        return;
      }
      const instanceId = inst.id;
      // Project ids installed while this panel is open (a mod and the dependencies that came with it), so cards
      // already on screen and the ones the next pages bring all show "Instalat" without a new search.
      const installedNow = new Set();
      const buttons = new Map(); // projectId → [button]
      const markInstalled = (btn) => {
        btn.disabled = true;
        btn.className = 'btn sm installed';
        btn.replaceChildren(icon('check'), t('Installed'));
      };
      const card = (m, i) => {
        const btn = h('button', { class: 'btn sm primary', type: 'button', dataset: { project: m.id } }, icon('download'), t('Install'));
        if (!buttons.has(m.id)) buttons.set(m.id, []);
        buttons.get(m.id).push(btn);
        if (m.installed || installedNow.has(m.id)) markInstalled(btn);
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.replaceChildren(h('span', { class: 'spinner' }));
          try {
            const added = await api.mods.install(instanceId, m.id);
            for (const pid of [m.id, ...added.map((a) => a.projectId)]) {
              installedNow.add(pid);
              (buttons.get(pid) || []).forEach(markInstalled);
            }
            toast('success', t('{name} installed', { name: m.title }), added.length > 1 ? t('plus the dependencies: {list}', { list: added.slice(1).map((a) => a.file).join(', ') }) : '');
          } catch (err) {
            btn.disabled = false;
            btn.replaceChildren(icon('download'), t('Install'));
            toastError(err, t('Install failed'));
          }
        });
        return h('div', { class: 'card result-card', vars: { '--i': i % 20 } },
          modIcon(m.icon),
          h('div', { class: 'grow' },
            h('div', { class: 'mod-name' }, m.title),
            h('div', { class: 'hint' }, t('by {author} · {n} downloads', { author: m.author, n: formatCount(m.downloads) })),
            h('div', { class: 'mod-desc', style: { margin: '6px 0 10px' } }, m.description),
            btn,
          ),
        );
      };

      // Infinite list: the next page loads when the end of the list comes within ~900 px of view.
      const page = { seq: 0, offset: 0, total: Infinity, loading: false, seen: new Set() };
      const showEnd = () => {
        sentinel.replaceChildren(page.offset >= page.total && page.offset > 0 ? h('div', { class: 'hint' }, t('You have seen all {n} mods.', { n: page.seen.size })) : '');
      };
      const loadMore = async () => {
        if (page.loading || page.offset >= page.total || disposed) return;
        page.loading = true;
        const seq = page.seq;
        sentinel.replaceChildren(h('span', { class: 'spinner' }), h('span', { class: 'hint' }, t('Loading…')));
        try {
          const res = await api.mods.search(instanceId, q.value, page.offset);
          if (seq !== page.seq || disposed) return;
          if (page.offset === 0) results.replaceChildren();
          page.total = res.total;
          page.offset += res.hits.length;
          if (!res.hits.length) page.total = page.offset; // nothing more, whatever the reported total says
          // Modrinth may repeat a project across pages while its ranking shifts; show each once.
          const fresh = res.hits.filter((m) => !page.seen.has(m.id));
          fresh.forEach((m) => page.seen.add(m.id));
          results.append(...fresh.map((m, i) => card(m, i)));
          results.classList.add('stagger');
          if (!page.seen.size) results.replaceChildren(h('div', { class: 'card pad empty' }, t('No results for this version.')));
          countLbl.textContent = page.seen.size ? t('{n} of {total}', { n: page.seen.size, total: formatCount(page.total) }) : '';
          page.loading = false;
          showEnd();
          // Still at the bottom (short page or a big window): keep filling.
          if (isNearEnd()) loadMore();
        } catch (err) {
          page.loading = false;
          if (seq !== page.seq) return;
          if (page.offset === 0) results.replaceChildren(h('div', { class: 'card pad empty' }, t('Modrinth does not answer. Check the internet connection.')));
          sentinel.replaceChildren(h('button', { class: 'btn sm', type: 'button', onclick: loadMore }, icon('refresh'), t('Retry')));
          toastError(err);
        }
      };
      const isNearEnd = () => sentinel.getBoundingClientRect().top - root.getBoundingClientRect().bottom < 900;
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      }, { root, rootMargin: '0px 0px 900px 0px' });
      observer.observe(sentinel);

      const restart = () => {
        page.seq++;
        page.offset = 0;
        page.total = Infinity;
        page.loading = false;
        page.seen.clear();
        buttons.clear();
        countLbl.textContent = '';
        results.classList.remove('stagger');
        results.replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'skeleton', style: { height: '92px' } })));
        root.scrollTo({ top: 0 });
        loadMore();
      };
      let timer = 0;
      q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(restart, 320);
      });
      restart();
      q.focus();
    }

    function render() {
      inst = selectedInstance();
      if (!inst) return;
      observer?.disconnect();
      if (tab === 'installed') renderInstalled();
      else renderDiscover();
    }

    // Drag & drop anywhere in the window.
    let depth = 0;
    const onEnter = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth++;
      drop.classList.add('on');
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) drop.classList.remove('on');
    };
    const onOver = (e) => e.preventDefault();
    const onDrop = async (e) => {
      e.preventDefault();
      depth = 0;
      drop.classList.remove('on');
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.toLowerCase().endsWith('.jar'));
      if (!files.length) {
        toast('info', t('Only .jar files'), t('Fabric mods are .jar files.'));
        return;
      }
      try {
        const added = await api.mods.addDropped(inst.id, files);
        toast('success', t('{n} mods added', { n: added.length }), added.join(', '));
        if (tab === 'installed') renderInstalled();
      } catch (err) {
        toastError(err);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);

    render();
    return () => {
      disposed = true;
      observer?.disconnect();
      drop.remove();
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  },
};

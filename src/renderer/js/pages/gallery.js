import { h, icon, toast, toastError, timeAgo, formatBytes, confirmDialog, modal } from '../ui.js';
import { state } from '../state.js';
import { t } from '../i18n.js';

const api = window.amethyst;

const shotUrl = (s) => `shots/${encodeURIComponent(s.instance)}/${encodeURIComponent(s.file)}`;

/** Full-size viewer: arrow keys / buttons to move, actions for the current picture. */
function lightbox(list, start, onDeleted) {
  let index = start;
  let onKey = null;
  modal((box, close) => {
    box.classList.add('lightbox');
    const img = h('img', { class: 'lb-img', alt: '' });
    const caption = h('div', { class: 'lb-caption' });
    const prev = h('button', { class: 'btn icon lb-nav prev', type: 'button', 'aria-label': t('Previous') }, icon('chevronLeft'));
    const next = h('button', { class: 'btn icon lb-nav next', type: 'button', 'aria-label': t('Next') }, icon('chevronRight'));
    const show = (i) => {
      index = (i + list.length) % list.length;
      const s = list[index];
      img.classList.remove('in');
      img.src = shotUrl(s);
      img.decode().catch(() => {}).finally(() => img.classList.add('in'));
      caption.replaceChildren(h('b', {}, s.file), h('span', {}, `${s.instanceName} · ${timeAgo(s.time)} · ${formatBytes(s.size)} · ${index + 1}/${list.length}`));
      prev.disabled = next.disabled = list.length < 2;
    };
    prev.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));
    onKey = (e) => {
      if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    };
    document.addEventListener('keydown', onKey);
    const actions = h('div', { class: 'row lb-actions' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.shots.copy(list[index].instance, list[index].file).then(() => toast('success', t('Image copied'), t('Paste it anywhere with Ctrl+V.'))).catch(toastError) }, icon('copy'), t('Copy image')),
      h('button', { class: 'btn sm', type: 'button', onclick: () => api.shots.reveal(list[index].instance, list[index].file).catch(toastError) }, icon('folder'), t('Show in folder')),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
        const s = list[index];
        if (!(await confirmDialog(t('Delete this screenshot?'), t('It goes to the Recycle Bin.'), { okText: t('Delete'), danger: true }))) return;
        try {
          await api.shots.remove(s.instance, s.file);
          list.splice(index, 1);
          onDeleted(s);
          if (!list.length) close();
          else show(index);
        } catch (err) {
          toastError(err);
        }
      } }, icon('trash'), t('Delete')),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => close() }, t('Close')),
    );
    box.append(h('div', { class: 'lb-stage' }, prev, img, next), caption, actions);
    show(index);
  }, { onClose: () => document.removeEventListener('keydown', onKey) });
}

export default {
  mount(root, { params }) {
    let filter = params?.instance || 'all';
    let shots = [];
    let disposed = false;

    const picker = h('select', { class: 'select', style: { width: '240px' } },
      h('option', { value: 'all' }, t('All instances')),
      ...state.instances.map((i) => h('option', { value: i.id }, i.name)));
    picker.value = state.instances.some((i) => i.id === filter) ? filter : 'all';
    filter = picker.value;
    const count = h('span', { class: 'hint' });
    const grid = h('div', { class: 'shot-grid' });

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { class: 'page-title' }, t('Gallery')), h('p', { class: 'page-sub' }, t('Your Minecraft screenshots (F2 in the game), from every instance.'))),
        h('div', { class: 'row' }, count, picker),
      ),
      grid,
    );

    const render = () => {
      count.textContent = shots.length ? t('{n} screenshots', { n: shots.length }) : '';
      if (!shots.length) {
        grid.replaceChildren(h('div', { class: 'card pad empty shot-empty' }, icon('image'), t('No screenshots yet. Press F2 in the game and they show up here.')));
        return;
      }
      grid.replaceChildren(...shots.map((s, i) => {
        const img = h('img', { src: shotUrl(s), alt: s.file, loading: 'lazy', decoding: 'async' });
        img.addEventListener('load', () => img.classList.add('in'));
        return h('button', { class: 'shot', type: 'button', vars: { '--i': Math.min(i, 24) }, title: s.file, onclick: () => lightbox(shots, i, () => render()) },
          img,
          h('span', { class: 'shot-meta' }, h('b', {}, s.instanceName), h('span', {}, timeAgo(s.time))),
        );
      }));
    };

    const load = async () => {
      grid.replaceChildren(...[0, 1, 2, 3, 4, 5].map(() => h('div', { class: 'skeleton shot-skel' })));
      try {
        const list = await api.shots.list(filter === 'all' ? null : filter);
        if (disposed) return;
        shots = list;
        render();
      } catch (err) {
        toastError(err);
      }
    };
    picker.addEventListener('change', () => {
      filter = picker.value;
      load();
    });
    load();
    return () => {
      disposed = true;
    };
  },
};

import { h, icon, toggle, segmented, toast, toastError } from '../ui.js';
import { state, on } from '../state.js';
import { t, getLanguage } from '../i18n.js';

const api = window.amethyst;
const LEVELS = { all: null, warn: new Set(['WARN', 'ERROR', 'FATAL']), error: new Set(['ERROR', 'FATAL']) };

function lineEl(l) {
  const time = new Date(l.time).toLocaleTimeString(getLanguage() === 'ro' ? 'ro-RO' : 'en-GB', { hour12: false });
  return h('div', { class: `log-line ${l.level}` },
    h('span', { class: 'faint' }, `${time} `),
    h('span', { class: 'lv' }, l.level),
    l.thread ? h('span', { class: 'th' }, `[${l.thread}] `) : null,
    l.text,
  );
}

export default {
  mount(root) {
    let level = 'all';
    let query = '';
    let follow = true;
    const box = h('div', { class: 'card console' });
    const search = h('input', { class: 'input', placeholder: t('Filter…'), style: { width: '240px' } });
    const count = h('span', { class: 'hint' });

    const matches = (l) => (!LEVELS[level] || LEVELS[level].has(l.level)) && (!query || l.text.toLowerCase().includes(query));

    function renderAll() {
      const lines = state.logs.filter(matches).slice(-1500);
      const frag = document.createDocumentFragment();
      for (const l of lines) frag.append(lineEl(l));
      box.replaceChildren(frag);
      if (!lines.length) box.append(h('div', { class: 'empty' }, icon('cpu'), state.logs.length ? t('No line matches the filter.') : t('Start the game: the log shows up here in real time.')));
      count.textContent = t('{n} lines', { n: state.logs.length });
      if (follow) box.scrollTop = box.scrollHeight;
    }

    // New lines are appended in batches per animation frame, not one DOM write per line.
    let queue = [];
    let raf = 0;
    const off = on('log', ({ lines }) => {
      queue.push(...lines);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (box.querySelector('.empty')) box.replaceChildren();
        const frag = document.createDocumentFragment();
        for (const l of queue) if (matches(l)) frag.append(lineEl(l));
        queue = [];
        box.append(frag);
        while (box.childElementCount > 1500) box.firstElementChild.remove();
        count.textContent = t('{n} lines', { n: state.logs.length });
        if (follow) box.scrollTop = box.scrollHeight;
      });
    });
    const offExit = on('exit', (p) => {
      if (p.crashReport) {
        box.append(h('div', { class: 'log-line ERROR' }, h('span', { class: 'lv' }, 'CRASH'), t('Report:'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => api.app.open(`file:${p.crashReport}`).catch(toastError) }, icon('external'), t('Open the report'))));
      }
    });

    box.addEventListener('scroll', () => {
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      if (atBottom !== follow) {
        follow = atBottom;
        followToggle.querySelector('input').checked = follow;
      }
    });
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      renderAll();
    });
    const followToggle = toggle(follow, (v) => {
      follow = v;
      if (v) box.scrollTop = box.scrollHeight;
    }, t('Follow'));

    root.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, t('Console')), h('p', { class: 'page-sub' }, t('The game log in real time.')))),
      h('div', { class: 'toolbar' },
        segmented([{ label: t('All'), value: 'all' }, { label: t('Warnings'), value: 'warn' }, { label: t('Errors'), value: 'error' }], level, (v) => { level = v; renderAll(); }),
        search, h('span', { class: 'grow' }), count,
        h('span', { class: 'row hint' }, t('Follow'), followToggle),
        h('button', { class: 'btn sm', type: 'button', onclick: () => {
          const text = state.logs.filter(matches).map((l) => `[${l.level}] ${l.thread ? `[${l.thread}] ` : ''}${l.text}`).join('\n');
          navigator.clipboard.writeText(text).then(() => toast('success', t('Log copied')));
        } }, icon('copy'), t('Copy')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { state.logs.length = 0; renderAll(); } }, icon('trash'), t('Clear')),
      ),
      box,
    );
    renderAll();
    return () => {
      off();
      offExit();
      cancelAnimationFrame(raf);
    };
  },
};

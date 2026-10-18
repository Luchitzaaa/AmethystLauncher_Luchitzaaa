// Small DOM toolkit. Everything goes through textContent / properties, never innerHTML with data,
// so text from mods, Modrinth or the game log can't inject markup.

import { t } from './i18n.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  cube: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 22V12M3.5 7L12 12l8.5-5"/>',
  gem: '<path d="M12 2l7 6-2.8 14H7.8L5 8z"/><path d="M5 8h14M12 2v20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  module: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  lan: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2.5h12V16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5.5-5.5L5 20"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  upgrade: '<path d="M12 19V7M6 12l6-6 6 6"/><path d="M5 21h14"/>',
  language: '<path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5 7M11 5c-.7 3.5-3 6.5-6.5 8"/><path d="M13 20l4-9 4 9M14.5 17h5"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  sparkles: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M19 15l.8 1.7 1.7.8-1.7.8L19 20l-.8-1.7-1.7-.8 1.7-.8z"/>',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (cls) svg.setAttribute('class', cls);
  // Static markup from the table above only.
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

/** Click ripple from the pointer position, for any .btn. */
export function installRipples(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .play');
    if (!btn || btn.disabled || btn.classList.contains('busy')) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const dot = h('span', { class: 'ripple', style: { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` } });
    btn.append(dot);
    dot.addEventListener('animationend', () => dot.remove());
  });
}

// ───────────────────────── toasts
export function toast(type, title, message = '', ms = 4200) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'ic' }, icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info')),
    h('div', { class: 'grow' }, h('div', { class: 'tt' }, title), message ? h('div', { class: 'tm' }, message) : null),
    h('span', { class: 'life', style: { animationDuration: `${ms}ms` } }),
  );
  const close = () => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  el.addEventListener('click', close);
  root.append(el);
  setTimeout(close, ms);
  while (root.children.length > 5) root.firstChild.remove();
}

export function toastError(err, title = t('Something went wrong')) {
  toast('error', title, err?.message || String(err), 7000);
}

// ───────────────────────── modals
let openModals = 0;

export function modal(build, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = h('div', { class: 'backdrop' });
  const box = h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true' });
  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    document.body.classList.toggle('modal-open', --openModals > 0);
    backdrop.classList.remove('on');
    box.classList.remove('on');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      backdrop.remove();
      box.remove();
    }, 300);
    onClose?.(value);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close(null);
  };
  backdrop.addEventListener('click', () => close(null));
  document.addEventListener('keydown', onKey);
  build(box, close);
  // Content rises in one row after another once the box has sprung open.
  [...box.children].forEach((c, i) => c.style.setProperty('--i', i));
  root.append(backdrop, box);
  openModals++;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    backdrop.classList.add('on');
    box.classList.add('on');
    box.querySelector('input, button.primary')?.focus();
  });
  return close;
}

export function confirmDialog(title, message, { okText = t('Confirm'), danger = false, extra } = {}) {
  return new Promise((resolve) => {
    modal((box, close) => {
      const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => close(true) }, okText);
      box.append(
        h('h2', {}, title),
        h('p', { class: 'muted' }, message),
        extra || null,
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close(false) }, t('Cancel')), ok),
      );
    }, { onClose: (v) => resolve(!!v) });
  });
}

// ───────────────────────── controls
export function toggle(checked, onChange, label = '') {
  const input = h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'knob' }));
}

/** Range slider with a live value bubble; format(v) renders the value, describe(v) the line below. */
export function slider({ name, min, max, step = 1, value, format = (v) => v, describe, onInput, onChange }) {
  const valueEl = h('span', { class: 'slider-value' }, format(value));
  const desc = describe ? h('div', { class: 'slider-desc' }, describe(value)) : null;
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': name });
  const paint = () => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    valueEl.textContent = format(v);
    if (desc) desc.textContent = describe(v);
  };
  input.addEventListener('input', () => {
    paint();
    valueEl.classList.add('bump');
    clearTimeout(input._t);
    input._t = setTimeout(() => valueEl.classList.remove('bump'), 160);
    onInput?.(Number(input.value));
  });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  paint();
  return h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, h('span', { class: 'slider-name' }, name), valueEl), input, desc);
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.value === value ? 'on' : '', role: 'radio', 'aria-checked': String(o.value === value) }, o.label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

// ───────────────────────── formatting
export function formatDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return t('{m} min', { m });
  const hrs = Math.floor(m / 60);
  return t('{h} h {m} min', { h: hrs, m: m % 60 });
}

export function timeAgo(ts) {
  if (!ts) return t('never');
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t('a few seconds ago');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  return d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** Sets the CSS variable a .skin-head uses to draw the face from a skin texture. */
export function setSkin(el, skinUrl) {
  if (skinUrl && /^https:\/\/textures\.minecraft\.net\//.test(skinUrl)) el.style.setProperty('--skin', `url("${skinUrl}")`);
  else el.style.removeProperty('--skin');
}

/** Face for an account: the head of its Microsoft skin. */
export function setAvatar(el, account) {
  setSkin(el, account?.skinUrl);
}

/** Small MICROSOFT label for an account. */
export function accountBadge() {
  return h('span', { class: 'acc-badge ms' }, 'Microsoft');
}
export function gem(color) {
  const g = h('span', { class: 'gem', vars: { '--gem': color || '#a78bfa' } });
  g.append(icon('gem'));
  return g;
}

import { h, icon, toast, toastError, modal, installRipples, setAvatar, accountBadge } from './ui.js';
import { state, init, on, refreshAccounts } from './state.js';
import { startBackground, burst } from './fx/background.js';
import { liquidMove, replay } from './fx/motion.js';
import { t, setLanguage, getLanguage, translateDom } from './i18n.js';
import home from './pages/home.js';
import instances from './pages/instances.js';
import mods from './pages/mods.js';
import gallery from './pages/gallery.js';
import options from './pages/options.js';
import consolePage from './pages/console.js';

const api = window.amethyst;
const PAGES = { home, instances, mods, gallery, options, console: consolePage };
const ORDER = ['home', 'instances', 'mods', 'gallery', 'options', 'console'];
const INTRO_MIN_MS = 750;
const bootStarted = performance.now();
let current = { id: null, unmount: null, el: null, params: {} };
let bg;
let indicatorY = null;
let chipAccount;

export function navigate(id, params = {}) {
  const page = PAGES[id];
  if (!page) return;
  const content = document.getElementById('content');
  // Pages slide in the direction of travel through the sidebar.
  const dir = current.id && ORDER.indexOf(id) < ORDER.indexOf(current.id) ? -1 : 1;
  if (current.el) {
    const old = current.el;
    current.unmount?.();
    old.style.setProperty('--dir', dir);
    old.classList.add('leaving');
    setTimeout(() => old.remove(), 260);
  }
  const el = h('section', { class: 'page', 'data-page': id, vars: { '--dir': dir } });
  content.append(el);
  const changed = current.id !== id;
  current = { id, el, params, unmount: page.mount(el, { navigate, openAccounts, params }) || null };
  moveIndicator(id, changed);
}

function moveIndicator(id, animate = false) {
  const items = [...document.querySelectorAll('.nav-item')];
  const btn = items.find((b) => b.dataset.page === id);
  items.forEach((b) => b.classList.toggle('active', b === btn));
  const ind = document.getElementById('nav-indicator');
  if (!btn) return;
  const y = btn.offsetTop - 14;
  ind.style.top = '14px';
  liquidMove(ind, animate ? indicatorY : null, y, btn.offsetHeight);
  indicatorY = y;
  ind.style.opacity = '1';
  if (animate) replay(btn, 'bounce');
}

function renderAccountChip() {
  const active = state.accounts.find((a) => a.active) || null;
  const chip = document.getElementById('account-chip');
  document.getElementById('account-name').textContent = active ? active.name : t('Sign in');
  setAvatar(document.getElementById('account-head'), active);
  chip.title = active ? `${active.name} · ${t('Microsoft account')}` : t('Accounts');
  const id = active?.id ?? null;
  if (chipAccount !== undefined && chipAccount !== id) replay(chip, 'swap');
  chipAccount = id;
}

/** Account manager: Microsoft accounts only. */
export function openAccounts() {
  modal((box, close) => {
    const list = h('div', { class: 'col acc-list' });
    const paint = () => {
      list.replaceChildren();
      if (!state.accounts.length) list.append(h('div', { class: 'empty' }, icon('user'), t('No accounts added yet.')));
      state.accounts.forEach((a, i) => {
        const head = h('span', { class: 'skin-head' });
        setAvatar(head, a);
        const hint = a.needsLogin ? t('Session expired: sign in again') : t('Verified online · any server');
        list.append(h('div', { class: `acc-row${a.active ? ' on' : ''}`, vars: { '--i': i } },
          head,
          h('div', { class: 'grow' }, h('div', { class: 'acc-title' }, h('span', { class: 'mod-name' }, a.name), accountBadge(a)), h('div', { class: 'hint' }, hint)),
          a.active
            ? h('span', { class: 'chip good' }, h('span', { class: 'dot' }), t('Active'))
            : h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api.accounts.select(a.id); await refreshAccounts(); paint(); } }, t('Use')),
          h('button', { class: 'btn sm icon danger', type: 'button', title: t('Remove'), onclick: async () => { await api.accounts.remove(a.id); await refreshAccounts(); paint(); } }, icon('trash')),
        ));
      });
    };
    paint();

    // ── Microsoft
    const msSub = h('small', {}, t('Verified online · any server'));
    const msBtn = h('button', { class: 'add-option ms', type: 'button' },
      h('span', { class: 'ao-ic' }, icon('shield')),
      h('span', { class: 'ao-txt' }, h('b', {}, t('Microsoft account')), msSub));
    msBtn.addEventListener('click', async () => {
      if (!state.settings.azureClientId) {
        toast('info', t('The Azure application ID is missing'), t('Enter it in Options → Accounts.'), 8000);
        close();
        navigate('options', { section: 'account' });
        return;
      }
      msBtn.disabled = true;
      msSub.replaceChildren(h('span', { class: 'spinner sm' }), t('Waiting for sign-in…'));
      try {
        const acc = await api.accounts.login();
        await refreshAccounts();
        toast('success', t('Welcome, {name}!', { name: acc.name }), t('The Microsoft account was verified online.'));
        paint();
      } catch (err) {
        if (err.code !== 'cancelled') toastError(err, t('Sign-in failed'));
      } finally {
        msBtn.disabled = false;
        msSub.replaceChildren(t('Verified online · any server'));
      }
    });

    box.classList.add('accounts-modal');
    box.append(
      h('h2', {}, t('Accounts')),
      h('p', { class: 'muted' }, t('Sign in with the Microsoft account that owns Minecraft: Java Edition. Ownership is verified online and the tokens are encrypted by Windows (DPAPI).')),
      list,
      h('div', { class: 'add-grid single' }, msBtn),
      h('div', { class: 'foot' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, t('Close'))),
    );
  });
}

function applyMotion() {
  document.body.classList.toggle('calm', !!state.settings?.reducedMotion);
  bg?.update();
}

/** Switches the whole UI to the settings' language without a reload: static markup, title bar, current page. */
function applyLanguage() {
  if (state.settings.language === getLanguage()) return;
  setLanguage(state.settings.language);
  translateDom();
  renderAccountChip();
  if (current.id) navigate(current.id, current.params);
}

/** Ends the intro: the crystal fades out while the title bar, sidebar and first page slide in. */
async function finishIntro() {
  const wait = INTRO_MIN_MS - (performance.now() - bootStarted);
  if (wait > 0 && !document.body.classList.contains('calm')) await new Promise((r) => setTimeout(r, wait));
  document.body.classList.remove('boot');
  document.body.classList.add('ready');
  setTimeout(() => document.getElementById('intro')?.remove(), 900);
}

async function boot() {
  installRipples();
  translateDom();
  bg = startBackground(document.getElementById('scene'));
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api.app.window(b.dataset.win)));
  document.querySelectorAll('.nav-item').forEach((b, i) => {
    b.style.setProperty('--i', i);
    b.addEventListener('click', () => navigate(b.dataset.page));
  });
  document.getElementById('account-chip').addEventListener('click', () => openAccounts());

  try {
    await init();
  } catch (err) {
    finishIntro();
    toastError(err, t('The launcher could not start'));
    return;
  }
  setLanguage(state.settings.language);
  translateDom();
  document.getElementById('app-version').textContent = `v${state.info.version}`;
  renderAccountChip();
  applyMotion();
  on('accounts', renderAccountChip);
  on('settings', () => {
    applyMotion();
    applyLanguage();
  });
  const syncGame = () => bg.setGameRunning(state.running.size > 0);
  on('running', syncGame);
  on('exit', (p) => {
    syncGame();
    const inst = state.instances.find((i) => i.id === p.id);
    if (p.code === 0 || p.code === null) toast('info', t('Game closed'), inst ? inst.name : '');
    else toast('error', t('Minecraft stopped unexpectedly'), p.crashReport ? t('The crash report is in the Console.') : t('Exit code {code}. See the Console.', { code: p.code }), 9000);
  });
  syncGame();
  if (!state.info.secureStorage) {
    toast('info', t('Secure storage unavailable'), t('Microsoft accounts will stay signed in only until you close the launcher.'), 8000);
  }
  await finishIntro();
  navigate('home');
  window.addEventListener('resize', () => moveIndicator(current.id));

  if (new URLSearchParams(location.search).has('selftest')) {
    const { installSelfTest } = await import('./selftest.js');
    installSelfTest({ navigate, openAccounts, background: bg });
  }
}

window.addEventListener('error', (e) => console.error('UI error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('UI promise:', e.reason?.message || e.reason));
boot();

import { h, icon, gem, toast, toastError, timeAgo, formatDuration, setAvatar, accountBadge, formatBytes } from '../ui.js';
import { state, on, selectedInstance, selectInstance, refreshInstances } from '../state.js';
import { burst } from '../fx/background.js';
import { tilt, magnetic, replay } from '../fx/motion.js';
import { t } from '../i18n.js';

const api = window.amethyst;

const PHASES = {
  auth: () => t('Checking the account'),
  version: () => t('Preparing the version'),
  java: () => 'Java',
  libraries: () => t('Libraries'),
  assets: () => t('Assets'),
  mods: () => t('Mods'),
  launching: () => t('Starting Minecraft'),
};

/** The hero crystal: a pulsing halo, two tilted orbits with sparks, the crystal and a light sweep. */
function crystalArt() {
  return h('div', { class: 'hero-art', 'aria-hidden': 'true' },
    h('span', { class: 'halo' }),
    h('span', { class: 'orbit o1' }, h('i', {})),
    h('span', { class: 'orbit o2' }, h('i', {})),
    h('span', { class: 'crystal-wrap' }, h('img', { class: 'hero-crystal', src: 'assets/logo.svg', alt: '' }), h('span', { class: 'sweep' })),
  );
}

function percent(p) {
  if (!p || !p.totalFiles) return null;
  if (p.bytesKnown !== false && p.totalBytes > 0) return Math.min(100, (p.doneBytes / p.totalBytes) * 100);
  return Math.min(100, (p.doneFiles / p.totalFiles) * 100);
}

const worldIcon = (instId, folder) => `world-icon/${encodeURIComponent(instId)}/${encodeURIComponent(folder)}`;

export default {
  mount(root, { navigate, openAccounts }) {
    const offs = [];
    const playBtn = h('button', { class: 'play', type: 'button' });
    const busyText = document.createTextNode('');
    const busy = { bar: h('span', { class: 'bar' }), text: busyText, label: h('span', { class: 'label' }, h('span', { class: 'spinner' }), busyText) };
    const cancelBtn = h('button', { class: 'btn icon hidden', type: 'button', title: t('Cancel') }, icon('x'));
    const startIn = h('button', { class: 'start-in', type: 'button', 'aria-haspopup': 'menu' });
    const heroName = h('h1', { class: 'hero-name' });
    const heroChips = h('div', { class: 'hero-chips' });
    const heroMeta = h('div', { class: 'hero-meta' });
    const strip = h('div', { class: 'instance-strip' });
    const accountBox = h('div', { class: 'card pad shine' });
    const shotsBox = h('div', { class: 'card pad shine' });

    const hero = h('div', { class: 'card hero shine' },
      crystalArt(),
      h('div', { class: 'hero-kicker' }, t('Selected instance')),
      heroName,
      heroChips,
      heroMeta,
      h('div', { class: 'play-row' }, playBtn, cancelBtn, startIn),
    );

    root.append(
      h('div', { class: 'home-grid stagger' },
        h('div', { vars: { '--i': 0 } }, hero, strip),
        h('div', { class: 'side-stack', vars: { '--i': 1 } }, accountBox, shotsBox),
      ),
    );

    let shownInstance = null;
    function renderHero() {
      const inst = selectedInstance();
      if (!inst) return;
      heroName.textContent = inst.name;
      if (shownInstance !== inst.id) {
        // A new instance name sweeps in from the left; re-renders of the same one stay still.
        if (shownInstance) replay(heroName, 'reveal');
        shownInstance = inst.id;
      }
      heroChips.replaceChildren(
        h('span', { class: 'chip accent' }, `Minecraft ${inst.version}`),
        h('span', { class: 'chip' }, inst.loader.type === 'fabric' ? `Fabric ${inst.loader.version === 'latest' ? t('· latest stable') : inst.loader.version}` : 'Vanilla'),
      );
      heroMeta.replaceChildren(
        h('div', {}, t('Last session'), h('b', {}, timeAgo(inst.lastPlayed))),
        h('div', {}, t('Time played'), h('b', {}, formatDuration(inst.playTimeMs || 0))),
        h('div', {}, t('Memory'), h('b', {}, `${((inst.memory?.max ?? state.settings.memory.max) / 1024).toFixed(1)} GB`)),
      );
      renderStartIn();
      renderPlay();
    }

    // ── "Start in": title screen, a singleplayer world or a server (Minecraft quick play).
    function renderStartIn() {
      const inst = selectedInstance();
      const q = inst?.quickPlay || { type: 'menu' };
      const label = q.type === 'world' ? q.label || q.target : q.type === 'server' ? q.target : t('Title screen');
      startIn.replaceChildren(
        icon(q.type === 'world' ? 'globe' : q.type === 'server' ? 'server' : 'play'),
        h('span', { class: 'si-txt' }, h('small', {}, t('Start in')), h('b', {}, label)),
        icon('chevronRight', 'si-chev'),
      );
      startIn.classList.toggle('set', q.type !== 'menu');
      startIn.title = t('Where the game starts');
    }

    let menu = null;
    const closeMenu = () => {
      menu?.remove();
      menu = null;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escKey);
    };
    const outside = (e) => {
      if (menu && !menu.contains(e.target) && !startIn.contains(e.target)) closeMenu();
    };
    const escKey = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    async function openMenu() {
      if (menu) {
        closeMenu();
        return;
      }
      const inst = selectedInstance();
      if (!inst) return;
      // In <body>, not inside the hero card (which clips its content), placed next to the button.
      menu = h('div', { class: 'qp-menu card', role: 'menu' }, h('div', { class: 'qp-loading' }, h('span', { class: 'spinner' })));
      const r = startIn.getBoundingClientRect();
      menu.style.left = `${Math.min(r.left, window.innerWidth - 340)}px`;
      menu.style.top = `${r.bottom + 8}px`;
      menu.style.maxHeight = `${Math.max(220, window.innerHeight - r.bottom - 24)}px`;
      document.body.append(menu);
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', escKey);
      let opts = { worlds: [], servers: [] };
      try {
        opts = await api.quickPlay.options(inst.id);
      } catch (err) {
        toastError(err);
      }
      if (!menu) return;
      const choose = async (choice) => {
        try {
          await api.quickPlay.set(inst.id, choice);
          await refreshInstances();
          renderStartIn();
          replay(startIn, 'pop');
        } catch (err) {
          toastError(err);
        }
        closeMenu();
      };
      const q = inst.quickPlay || { type: 'menu' };
      const item = (on, ic, title, sub, choice) => h('button', { class: `qp-item${on ? ' on' : ''}`, type: 'button', role: 'menuitem', onclick: () => choose(choice) },
        ic, h('span', { class: 'grow' }, h('b', {}, title), sub ? h('small', {}, sub) : null), on ? icon('check') : null);
      const worldIc = (w) => {
        const box = h('span', { class: 'qp-ic' });
        if (w.icon) {
          const img = h('img', { src: worldIcon(inst.id, w.folder), alt: '' });
          img.addEventListener('error', () => img.replaceWith(icon('globe')));
          box.append(img);
        } else box.append(icon('globe'));
        return box;
      };
      const serverIn = h('input', { class: 'input', placeholder: t('Server address, e.g. play.example.net'), spellcheck: 'false' });
      const addServer = h('form', { class: 'qp-add', novalidate: true }, serverIn, h('button', { class: 'btn sm primary', type: 'submit' }, t('Join')));
      addServer.addEventListener('submit', (e) => {
        e.preventDefault();
        const ip = serverIn.value.trim();
        if (/^[A-Za-z0-9.\-_\[\]:]{1,255}$/.test(ip)) choose({ type: 'server', target: ip });
        else replay(addServer, 'shake');
      });
      menu.replaceChildren(
        item(q.type === 'menu', h('span', { class: 'qp-ic' }, icon('play')), t('Title screen'), t('The normal Minecraft menu'), { type: 'menu' }),
        h('div', { class: 'qp-head' }, t('Singleplayer worlds')),
        ...(opts.worlds.length
          ? opts.worlds.slice(0, 12).map((w) => item(q.type === 'world' && q.target === w.folder, worldIc(w), w.name, t('Played {ago}', { ago: timeAgo(w.lastPlayed) }), { type: 'world', target: w.folder, label: w.name }))
          : [h('div', { class: 'qp-empty' }, t('No worlds yet. Create one in the game first.'))]),
        h('div', { class: 'qp-head' }, t('Servers')),
        ...opts.servers.slice(0, 12).map((s) => item(q.type === 'server' && q.target === s.ip, h('span', { class: 'qp-ic' }, icon('server')), s.name, s.ip, { type: 'server', target: s.ip })),
        addServer,
      );
      [...menu.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14)));
    }
    startIn.addEventListener('click', openMenu);

    function renderPlay() {
      const inst = selectedInstance();
      if (!inst) return;
      const p = state.progress.get(inst.id);
      playBtn.classList.remove('busy', 'running');
      cancelBtn.classList.add('hidden');
      startIn.classList.toggle('hidden', !!p || state.running.has(inst.id));
      if (state.running.has(inst.id)) {
        playBtn.classList.add('running');
        playBtn.replaceChildren(h('span', { class: 'label' }, h('span', { class: 'dot pulse' }), t('IN GAME · STOP')));
      } else if (p) {
        playBtn.classList.add('busy');
        cancelBtn.classList.remove('hidden');
        const pct = percent(p);
        // Reuse the same bar so its width animates smoothly between progress events.
        if (busy.bar.parentNode !== playBtn) playBtn.replaceChildren(busy.bar, busy.label);
        busy.bar.style.width = `${pct ?? 6}%`;
        const detail = p.totalFiles ? ` · ${p.doneFiles}/${p.totalFiles}${p.totalBytes ? ` · ${formatBytes(p.doneBytes)}` : ''}` : '';
        busy.text.textContent = `${PHASES[p.phase]?.() || p.label || t('Preparing')}${pct != null ? ` ${Math.floor(pct)}%` : ''}${detail}`;
      } else {
        const svg = icon('play');
        playBtn.replaceChildren(svg, h('span', {}, t('PLAY')));
      }
    }

    function renderStrip() {
      const sel = selectedInstance();
      strip.replaceChildren(...state.instances.map((inst) => h('button', {
        class: `instance-pill${inst.id === sel?.id ? ' on' : ''}`,
        type: 'button',
        onclick: async () => {
          await selectInstance(inst.id);
          closeMenu();
          renderAll();
        },
      }, gem(inst.color), h('div', {}, h('div', { class: 't' }, inst.name), h('div', { class: 's' }, `${inst.version} · ${inst.loader.type === 'fabric' ? 'Fabric' : 'Vanilla'}`)))));
    }

    function renderAccount() {
      const active = state.accounts.find((a) => a.active);
      const head = h('span', { class: 'skin-head lg' });
      setAvatar(head, active);
      const hint = !active ? t('Sign in with the Microsoft account that owns Minecraft')
        : active.needsLogin ? t('Session expired') : t('Verified online · any server');
      accountBox.replaceChildren(
        h('div', { class: 'card-title' }, icon('user'), t('Account')),
        h('div', { class: 'account-card' }, head,
          h('div', { class: 'grow' },
            h('div', { class: 'nm' }, active ? active.name : t('Not signed in'), active ? accountBadge(active) : null),
            h('div', { class: 'hint' }, hint),
          ),
        ),
        h('div', { class: 'row', style: { marginTop: '14px' } },
          h('button', { class: `btn ${active ? '' : 'primary'} sm`, type: 'button', onclick: () => openAccounts() }, active ? t('Manage accounts') : t('Sign in')),
        ),
      );
    }

    async function renderShots() {
      const inst = selectedInstance();
      const title = h('div', { class: 'card-title' }, icon('image'), t('Recent screenshots'));
      let list = [];
      try {
        list = inst ? await api.shots.list(inst.id) : [];
      } catch {
        list = [];
      }
      const open = () => navigate('gallery', { instance: inst?.id });
      const thumbs = list.slice(0, 4).map((s, i) => {
        const img = h('img', { src: `shots/${encodeURIComponent(s.instance)}/${encodeURIComponent(s.file)}`, alt: s.file, loading: 'lazy', decoding: 'async' });
        img.addEventListener('load', () => img.classList.add('in'));
        return h('button', { class: 'mini-shot', type: 'button', title: s.file, vars: { '--i': i }, onclick: open }, img);
      });
      shotsBox.replaceChildren(
        title,
        thumbs.length ? h('div', { class: 'mini-shots' }, ...thumbs)
          : h('div', { class: 'empty' }, icon('image'), t('No screenshots yet. Press F2 in the game and they show up here.')),
        h('button', { class: 'btn sm ghost', type: 'button', style: { marginTop: '10px' }, onclick: open }, icon('image'), t('Open the gallery')),
      );
    }

    function renderAll() {
      renderHero();
      renderStrip();
      renderAccount();
      renderShots();
    }

    playBtn.addEventListener('click', async () => {
      const inst = selectedInstance();
      if (!inst || state.progress.has(inst.id)) return;
      if (state.running.has(inst.id)) {
        await api.launch.kill(inst.id);
        return;
      }
      const account = state.accounts.find((a) => a.active);
      if (!account) {
        openAccounts();
        return;
      }
      closeMenu();
      const r = playBtn.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, { count: 42, power: 1.15 });
      state.progress.set(inst.id, { id: inst.id, phase: 'auth' });
      renderPlay();
      try {
        await api.launch.start(inst.id);
        const q = inst.quickPlay || { type: 'menu' };
        const where = q.type === 'world' ? t('straight into {world}', { world: q.target }) : q.type === 'server' ? t('joining {server}', { server: q.target }) : `${inst.version}`;
        toast('success', t('Minecraft is starting'), `${inst.name} · ${where}`);
      } catch (err) {
        state.progress.delete(inst.id);
        renderPlay();
        if (err.code !== 'cancelled') toastError(err, t('Could not start the game'));
      }
    });
    cancelBtn.addEventListener('click', () => {
      const inst = selectedInstance();
      if (inst) api.launch.cancel(inst.id);
    });

    let raf = 0;
    offs.push(on('progress', (p) => {
      if (p.id !== selectedInstance()?.id) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderPlay);
    }));
    offs.push(on('running', renderPlay));
    offs.push(on('exit', () => {
      renderPlay();
      renderShots();
    }));
    offs.push(on('accounts', renderAccount));
    offs.push(on('instances', () => {
      renderHero();
      renderStrip();
    }));

    tilt(hero, { max: 2.2, lift: 0 });
    tilt(accountBox, { max: 4, lift: 2 });
    tilt(shotsBox, { max: 4, lift: 2 });
    magnetic(playBtn);

    renderAll();
    return () => {
      offs.forEach((f) => f());
      cancelAnimationFrame(raf);
      closeMenu();
    };
  },
};

// UI self-test hooks, loaded only when the window URL has ?selftest=1 (launched with --ui-selftest).
// The main process drives these steps and takes a screenshot after each one.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function installSelfTest({ navigate, openAccounts, background }) {
  const api = window.amethyst;
  const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));
  const type = (selector, text) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Lipsește elementul ${selector}`);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el;
  };
  const click = (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Lipsește elementul ${selector}`);
    el.click();
  };
  const clickText = (selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.includes(text));
    if (!el) throw new Error(`Lipsește „${text}”`);
    el.click();
  };

  window.__selftest = {
    async step(name) {
      switch (name) {
        case 'home': {
          navigate('home');
          await wait(1300);
          for (let i = 0; i < 20 && !document.querySelector('.mini-shot img.in'); i++) await wait(150);
          return { title: document.querySelector('.hero-name')?.textContent, shots: document.querySelectorAll('.mini-shot').length };
        }
        case 'instances':
          navigate('instances');
          await wait(1100);
          return { cards: document.querySelectorAll('.inst-card').length };
        case 'instance-editor':
          click('[data-action="new-instance"]');
          await wait(2200);
          return { versions: document.querySelectorAll('.version-list button').length };
        case 'close-modal':
          press('Escape');
          await wait(500);
          return {};
        case 'mods':
          navigate('mods');
          await wait(1500);
          return { mods: document.querySelectorAll('.mod-row').length };
        case 'mods-discover':
          clickText('.segmented button', 'Discover');
          await wait(3500);
          return { results: document.querySelectorAll('.result-card').length };
        case 'mods-scroll': {
          // Infinite list: scrolling to the end keeps bringing new, distinct results.
          const page = document.querySelector('.page');
          const before = document.querySelectorAll('.result-card').length;
          for (let i = 0; i < 4; i++) {
            page.scrollTo({ top: page.scrollHeight });
            await wait(1600);
          }
          const cards = [...document.querySelectorAll('.result-card button[data-project]')].map((b) => b.dataset.project);
          if (cards.length < before + 40) throw new Error(`Lista nu s-a extins: ${before} → ${cards.length}`);
          if (new Set(cards).size !== cards.length) throw new Error('Rezultate duplicate în listă');
          return { before, after: cards.length, counter: document.querySelector('.page .toolbar .hint')?.textContent };
        }
        case 'mods-installed': {
          // Fabric API is in the test instance (added by hand, no Modrinth manifest): it must show as installed.
          const q = document.querySelector('.page .toolbar .input');
          q.value = 'fabric api';
          q.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(3500);
          const btn = document.querySelector('.result-card button[data-project="P7dR8mSH"]');
          if (!btn) throw new Error('Fabric API nu apare în rezultate');
          if (!btn.classList.contains('installed') || !btn.disabled) throw new Error(`Fabric API apare ca neinstalat: ${btn.textContent}`);
          const others = [...document.querySelectorAll('.result-card button[data-project]')].filter((b) => b.dataset.project !== 'P7dR8mSH' && b.classList.contains('installed'));
          return { fabricApi: btn.textContent, otherInstalled: others.length };
        }
        case 'options-account':
          clickText('.opt-nav button', 'Accounts');
          await wait(800);
          if (document.querySelector('.local-facts')) throw new Error('Secțiunea Cont local încă apare');
          if (document.querySelector('.opt-nav [data-section="modules"]')) throw new Error('Secțiunea Modules încă apare');
          return { sections: [...document.querySelectorAll('.opt-nav button')].map((b) => b.dataset.section) };
        case 'options-java':
          navigate('options', { section: 'general' });
          await wait(900);
          clickText('.opt-nav button', 'Java');
          await wait(800);
          return {};
        case 'console':
          navigate('console');
          await wait(900);
          return {};
        case 'accounts':
          openAccounts();
          await wait(900);
          if (document.querySelector('.add-option.local, .local-form')) throw new Error('Opțiunea de cont local încă apare');
          if (!document.querySelector('.add-option.ms')) throw new Error('Lipsește butonul Microsoft');
          return { rows: document.querySelectorAll('.acc-row').length, options: document.querySelectorAll('.add-option').length };
        case 'mods-updates': {
          // The test instance has an older Fabric API than Modrinth's latest for 26.3: the check must offer it.
          clickText('.segmented button', 'Installed');
          await wait(1200);
          click('[data-action="check-updates"]');
          for (let i = 0; i < 40 && !document.querySelector('[data-action="update-all"]'); i++) await wait(250);
          if (!document.querySelector('[data-action="update-all"]')) throw new Error('Nicio actualizare găsită pentru Fabric API 0.162.0');
          await wait(1200); // rows animate back in
          if (/null/.test(document.querySelector('.update-bar').textContent)) throw new Error('Bara de actualizări afișează „null”');
          const rows = [...document.querySelectorAll('.mod-row')].filter((r) => r.querySelector('.upd-chip'));
          await wait(1300); // the re-rendered rows fade in
          return { withUpdate: rows.map((r) => `${r.querySelector('.mod-name')?.textContent} → ${r.querySelector('.upd-chip')?.textContent}`) };
        }
        case 'language-ro': {
          navigate('options', { section: 'general' });
          await wait(900);
          click('.lang-opt[data-lang="ro"]');
          await wait(1200);
          const settings = await api.settings.get();
          const nav = [...document.querySelectorAll('[data-i18n]')].map((e) => e.textContent);
          if (settings.language !== 'ro' || document.documentElement.lang !== 'ro') throw new Error(`Limba nu s-a schimbat (${settings.language})`);
          if (!document.querySelector('.lang-opt[data-lang="ro"].on')) throw new Error('Butonul Română nu e selectat după reafișare');
          if (!nav.includes('Opțiuni')) throw new Error(`Meniul nu e tradus: ${nav.join(', ')}`);
          return { nav: nav.slice(0, 7) };
        }
        case 'home-ro':
          navigate('home');
          await wait(1300);
          return { play: document.querySelector('.play')?.textContent, startIn: document.querySelector('.start-in small')?.textContent };
        case 'language-en': {
          navigate('options', { section: 'general' });
          await wait(900);
          click('.lang-opt[data-lang="en"]');
          await wait(1200);
          if (document.documentElement.lang !== 'en') throw new Error(`Nu s-a revenit la engleză (${document.documentElement.lang})`);
          return { nav: [...document.querySelectorAll('[data-i18n]')].slice(0, 7).map((e) => e.textContent) };
        }
        case 'start-in': {
          navigate('home');
          await wait(1300);
          click('.start-in');
          for (let i = 0; i < 20 && !document.querySelector('.qp-menu .qp-head'); i++) await wait(150);
          await wait(700);
          const items = [...document.querySelectorAll('.qp-menu .qp-item b')].map((b) => b.textContent);
          if (items.length < 2) throw new Error(`Nicio lume în meniu: ${items.join(', ')}`);
          if (!document.querySelector('.qp-menu .qp-ic img')) throw new Error('Iconița lumii lipsește');
          return { items };
        }
        case 'start-in-world': {
          const worldItem = [...document.querySelectorAll('.qp-menu .qp-item')].find((b) => b.querySelector('.qp-ic img'));
          if (!worldItem) throw new Error('Nicio lume cu iconiță în meniu');
          const worldName = worldItem.querySelector('b').textContent;
          worldItem.click();
          await wait(900);
          const inst = (await api.instances.list()).find((i) => i.quickPlay?.type === 'world');
          if (!inst) throw new Error('Alegerea lumii nu s-a salvat');
          if (!document.querySelector('.start-in.set')) throw new Error('Butonul nu arată lumea aleasă');
          if (document.querySelector('.start-in b')?.textContent !== worldName) throw new Error('Butonul arată folderul, nu numele lumii');
          return { quickPlay: inst.quickPlay, label: document.querySelector('.start-in b')?.textContent };
        }
        case 'gallery': {
          navigate('gallery');
          for (let i = 0; i < 20 && !document.querySelector('.shot'); i++) await wait(150);
          await wait(1200);
          const shots = document.querySelectorAll('.shot').length;
          if (shots < 2) throw new Error(`Galeria arată ${shots} capturi`);
          const broken = [...document.querySelectorAll('.shot img')].filter((i) => i.complete && i.naturalWidth === 0).length;
          if (broken) throw new Error(`${broken} capturi nu se încarcă`);
          return { shots };
        }
        case 'gallery-lightbox': {
          document.querySelector('.shot').click();
          await wait(900);
          const first = document.querySelector('.lightbox .lb-img')?.getAttribute('src');
          if (!first) throw new Error('Lightbox-ul nu s-a deschis');
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
          await wait(700);
          const second = document.querySelector('.lightbox .lb-img')?.getAttribute('src');
          if (first === second) throw new Error('Săgeata dreapta nu trece la următoarea captură');
          return { first, second };
        }
        case 'gallery-close':
          press('Escape');
          await wait(700);
          if (document.querySelector('.lightbox')) throw new Error('Lightbox-ul nu s-a închis cu Escape');
          return {};
        case 'fx': {
          const before = background.stats();
          background.burst(window.innerWidth / 2, window.innerHeight / 2, { count: 40 });
          await wait(250);
          const during = background.stats();
          const t0 = performance.now();
          while (background.stats().particles > 0 && performance.now() - t0 < 5000) await wait(100);
          const clearedMs = Math.round(performance.now() - t0 + 250);
          const after = background.stats();
          if (!before.running || after.frames <= before.frames) throw new Error(`Fundalul nu rulează: ${JSON.stringify(after)}`);
          if (during.particles === 0) throw new Error('Explozia de particule nu a pornit');
          if (after.particles !== 0) throw new Error(`Particulele nu au dispărut în 5 s: ${JSON.stringify(after)}`);
          // The JS cost of one background frame (drawing the live canvas), averaged.
          if (after.frameCostMs > 8) throw new Error(`Cadru prea scump: ${after.frameCostMs} ms`);
          return { ...after, clearedMs, layers: document.querySelectorAll('.scene > *').length };
        }
        default:
          throw new Error(`Pas necunoscut ${name}`);
      }
    },
  };
  window.__selftestReady = true;
}

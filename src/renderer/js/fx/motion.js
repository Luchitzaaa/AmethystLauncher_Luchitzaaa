// Small interaction animations shared by the pages. All of them only touch transform/opacity or
// CSS variables, and all of them stand still in calm mode or with the OS "reduce motion" setting.

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const calm = () => reduceQuery.matches || document.body.classList.contains('calm');

/** 3D tilt towards the pointer plus a light spot (--mx/--my) that follows it. */
export function tilt(el, { max = 6, lift = 3 } = {}) {
  let raf = 0;
  let pending = null;
  const apply = () => {
    raf = 0;
    if (!pending) return;
    const { x, y } = pending;
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
    if (!calm()) el.style.transform = `perspective(1000px) rotateX(${(0.5 - y) * max * 0.8}deg) rotateY(${(x - 0.5) * max}deg) translateY(-${lift}px)`;
  };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    pending = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (!raf) raf = requestAnimationFrame(apply);
  });
  el.addEventListener('pointerenter', () => el.classList.add('tilting'));
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    raf = 0;
    pending = null;
    el.classList.remove('tilting');
    el.style.transform = '';
  });
}

/** Pulls an element a few pixels towards the pointer while it is near (used by the PLAY button). */
export function magnetic(el, { strength = 0.18, max = 8 } = {}) {
  let raf = 0;
  el.addEventListener('pointermove', (e) => {
    if (calm() || el.classList.contains('busy')) return;
    const r = el.getBoundingClientRect();
    const dx = Math.max(-max, Math.min(max, (e.clientX - (r.left + r.width / 2)) * strength));
    const dy = Math.max(-max, Math.min(max, (e.clientY - (r.top + r.height / 2)) * strength));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.setProperty('--mag-x', `${dx.toFixed(1)}px`);
      el.style.setProperty('--mag-y', `${dy.toFixed(1)}px`);
    });
  });
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    el.style.setProperty('--mag-x', '0px');
    el.style.setProperty('--mag-y', '0px');
  });
}

/**
 * Moves the sidebar indicator like a drop of liquid: the leading edge reaches the new item first, the
 * body stretches between the two, then the trailing edge catches up.
 */
export function liquidMove(el, fromY, toY, height) {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = `translateY(${toY}px)`;
  if (fromY == null || fromY === toY || calm()) return;
  const d = toY - fromY;
  const stretch = Math.abs(d) * 0.7;
  const midTop = d > 0 ? fromY + d * 0.15 : fromY + d * 0.85;
  el.animate([
    { transform: `translateY(${fromY}px)`, height: `${height}px` },
    { transform: `translateY(${midTop}px)`, height: `${height + stretch}px`, offset: 0.42 },
    { transform: `translateY(${toY}px)`, height: `${height}px` },
  ], { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
}

/** Re-runs a CSS animation class on an element (e.g. a pop when something changes). */
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// Amethyst cavern behind the UI, in layers (back to front):
//   far     nebula clouds and star dust, painted once per resize (value-noise fbm at 1/5 resolution)
//   aurora  soft colour blobs, rays: light beams from above (CSS, animated by the compositor)
//   glow    light pools under the crystal formations, pulsing through CSS opacity
//   live    the only canvas drawn every frame: twinkling stars, drifting shards with glints, firefly
//           motes in a flow field, shooting stars, the cursor light and click bursts
//   near    crystal geode formations along the edges, painted once per resize
// Everything drawn per frame is a pre-rendered sprite (no gradients or shadows in the loop) and parallax
// moves whole layers with CSS transforms. The loop runs at 40 fps (20 while the window is in the
// background), pauses while a game runs in front of the launcher, and stops when hidden or in calm mode.

const VIOLET = ['#f5f3ff', '#c4b5fd', '#8b5cf6', '#4c1d95', '#1a0a36'];
const PINK = ['#fdf2f8', '#f9a8d4', '#ec4899', '#831843', '#25081b'];
const ICE = ['#f0f9ff', '#bae6fd', '#38bdf8', '#075985', '#06182b'];
const FPS_FOCUSED = 40;
const FPS_BACKGROUND = 20;
const LAYER_PAD = 32; // parallax layers overhang the window so their edges never show
const MAX_PARTICLES = 260;

const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

let active = null;

/** Sparkle burst at a screen point (used by the PLAY button and other moments worth celebrating). */
export function burst(x, y, opts) {
  active?.burst(x, y, opts);
}

// ───────────────────────── sprites (rendered once)

function canvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(hgt));
  return c;
}

function glowSprite(radius, color, core = 0.35) {
  const c = canvas(radius * 2, radius * 2);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gr.addColorStop(0, color);
  gr.addColorStop(core, `${color}66`);
  gr.addColorStop(1, `${color}00`);
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Four-point star flare. */
function sparkleSprite(size, color) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const m = size / 2;
  const halo = g.createRadialGradient(m, m, 0, m, m, m * 0.6);
  halo.addColorStop(0, `${color}cc`);
  halo.addColorStop(1, `${color}00`);
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  g.fillStyle = color;
  for (const [w, hgt] of [[size * 0.07, m], [m, size * 0.07]]) {
    g.beginPath();
    g.moveTo(m, m - hgt);
    g.quadraticCurveTo(m + w * 0.2, m - w * 0.2, m + w, m);
    g.quadraticCurveTo(m + w * 0.2, m + w * 0.2, m, m + hgt);
    g.quadraticCurveTo(m - w * 0.2, m + w * 0.2, m - w, m);
    g.quadraticCurveTo(m - w * 0.2, m - w * 0.2, m, m - hgt);
    g.fill();
  }
  return c;
}

/** Meteor streak, head at the right edge. */
function streakSprite(len, color) {
  const c = canvas(len, 14);
  const g = c.getContext('2d');
  const tail = g.createLinearGradient(0, 0, len, 0);
  tail.addColorStop(0, `${color}00`);
  tail.addColorStop(0.75, `${color}55`);
  tail.addColorStop(1, '#ffffff');
  g.fillStyle = tail;
  g.beginPath();
  g.moveTo(0, 7);
  g.lineTo(len - 6, 5.6);
  g.lineTo(len, 7);
  g.lineTo(len - 6, 8.4);
  g.closePath();
  g.fill();
  g.drawImage(glowSprite(7, color, 0.25), len - 14, 0);
  return c;
}

function ringSprite(r, color) {
  const c = canvas(r * 2, r * 2);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(r, r, r * 0.6, r, r, r);
  gr.addColorStop(0, `${color}00`);
  gr.addColorStop(0.82, `${color}aa`);
  gr.addColorStop(1, `${color}00`);
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * One amethyst point seen from the side, growing from (x, y) towards local -y after rotating by angle:
 * a shadowed and a lit face split by a ridge, a bright tip facet and a light streak inside the crystal.
 * depth 0 (back) … 1 (front) darkens crystals further back so clusters read in 3D.
 */
function drawCrystal(g, x, y, angle, len, wid, pal, depth = 1) {
  const [c0, c1, c2, c3, c4] = pal;
  const hw = wid / 2;
  const sh = len * 0.8;
  const outline = () => {
    g.beginPath();
    g.moveTo(-hw, wid * 0.2);
    g.lineTo(-hw * 0.94, -sh);
    g.lineTo(0, -len);
    g.lineTo(hw * 0.94, -sh);
    g.lineTo(hw, wid * 0.2);
    g.closePath();
  };
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  let gr = g.createLinearGradient(0, 0, 0, -len);
  gr.addColorStop(0, c4);
  gr.addColorStop(0.55, c3);
  gr.addColorStop(1, c2);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-hw, wid * 0.2);
  g.lineTo(-hw * 0.94, -sh);
  g.lineTo(0, -len);
  g.lineTo(hw * 0.1, wid * 0.2);
  g.closePath();
  g.fill();
  gr = g.createLinearGradient(0, 0, 0, -len);
  gr.addColorStop(0, c3);
  gr.addColorStop(0.5, c2);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(hw * 0.1, wid * 0.2);
  g.lineTo(0, -len);
  g.lineTo(hw * 0.94, -sh);
  g.lineTo(hw, wid * 0.2);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.6;
  g.fillStyle = c0;
  g.beginPath();
  g.moveTo(0, -len);
  g.lineTo(hw * 0.94, -sh);
  g.lineTo(hw * 0.32, -sh * 0.97);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.3;
  gr = g.createLinearGradient(0, 0, 0, -len);
  gr.addColorStop(0, `${c0}00`);
  gr.addColorStop(1, c0);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(hw * 0.38, 0);
  g.lineTo(hw * 0.34, -sh * 0.94);
  g.lineTo(hw * 0.52, -sh * 0.92);
  g.lineTo(hw * 0.58, 0);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.45;
  g.strokeStyle = c1;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, -len);
  g.lineTo(hw * 0.1, wid * 0.2);
  g.stroke();
  g.globalAlpha = 0.25;
  g.strokeStyle = c0;
  outline();
  g.stroke();
  if (depth < 1) {
    g.globalAlpha = (1 - depth) * 0.55;
    g.fillStyle = '#0b0716';
    outline();
    g.fill();
  }
  g.restore();
}

/** Floating double-terminated shard with its glow baked in. */
function shardSprite(len, pal) {
  const wid = len * 0.42;
  const pad = len * 0.55;
  const c = canvas(wid + pad * 2, len * 1.6 + pad * 2);
  const g = c.getContext('2d');
  const cx = c.width / 2;
  const cy = pad + len;
  const halo = g.createRadialGradient(cx, cy - len * 0.2, 0, cx, cy - len * 0.2, len * 1.1);
  halo.addColorStop(0, `${pal[2]}44`);
  halo.addColorStop(1, `${pal[2]}00`);
  g.fillStyle = halo;
  g.fillRect(0, 0, c.width, c.height);
  drawCrystal(g, cx, cy, Math.PI, len * 0.55, wid, pal, 0.75);
  drawCrystal(g, cx, cy, 0, len, wid, pal, 1);
  return c;
}

function grainUrl() {
  const c = canvas(96, 96);
  const g = c.getContext('2d');
  const img = g.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 40;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

// ───────────────────────── static layers (painted on resize)

function makeNoise() {
  const p = new Uint8Array(512);
  const v = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    p[i] = i;
    v[i] = Math.random();
  }
  for (let i = 255; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const at = (x, y) => v[p[(x & 255) + p[y & 255]]];
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = x - xi;
    const w = y - yi;
    const fu = u * u * (3 - 2 * u);
    const fw = w * w * (3 - 2 * w);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * fu + (c - a) * fw + (a - b - c + d) * fu * fw;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
}

/** How close a point is to the diagonal "galactic band" from bottom-left to top-right (0…1). */
const band = (u, v) => Math.exp(-(((u + v - 1) / Math.SQRT2 / 0.3) ** 2));

function paintFar(c, w, hgt, dpr) {
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Nebula: three noise fields give density, colour and dark dust lanes.
  const S = 5;
  const nw = Math.ceil(w / S);
  const nh = Math.ceil(hgt / S);
  const neb = canvas(nw, nh);
  const nctx = neb.getContext('2d');
  const img = nctx.createImageData(nw, nh);
  const density = makeNoise();
  const hue = makeNoise();
  const lanes = makeNoise();
  const k = S / 420;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const n = density(x * k, y * k);
      const m = hue(x * k * 0.7 + 40, y * k * 0.7 + 9, 3);
      const l = lanes(x * k * 1.7 + 7, y * k * 1.7 + 3, 4);
      const b = band(x / nw, y / nh);
      const d = smooth(0.4, 0.74, n) * (0.28 + 0.72 * b) * (1 - 0.7 * smooth(0.55, 0.7, l));
      const t = smooth(0.38, 0.62, m);
      let r = 124 + (219 - 124) * t;
      let gg = 58 + (39 - 58) * t;
      let bb = 237 + (119 - 237) * t;
      const cyan = (1 - smooth(0.27, 0.37, m)) * 0.8;
      r += (14 - r) * cyan;
      gg += (165 - gg) * cyan;
      bb += (233 - bb) * cyan;
      const hot = smooth(0.62, 0.8, n) * 0.55;
      r += (240 - r) * hot;
      gg += (225 - gg) * hot;
      bb += (255 - bb) * hot;
      const i = (y * nw + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = bb;
      img.data[i + 3] = d * 215;
    }
  }
  nctx.putImageData(img, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.filter = 'blur(3px)';
  g.drawImage(neb, 0, 0, w, hgt);
  g.filter = 'none';

  // Star dust, denser inside the band, plus a few bright flares.
  const tints = ['#ffffff', '#ede9fe', '#ddd6fe', '#bae6fd', '#fbcfe8'];
  const count = Math.round((w * hgt) / 2400);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * hgt;
    if (Math.random() > 0.3 + 0.7 * band(x / w, y / hgt)) continue;
    g.globalAlpha = 0.18 + Math.random() ** 2 * 0.7;
    g.fillStyle = tints[(Math.random() * tints.length) | 0];
    g.beginPath();
    g.arc(x, y, 0.35 + Math.random() ** 3 * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  const flare = sparkleSprite(22, '#ede9fe');
  for (let i = 0; i < 12; i++) {
    const s = rnd(10, 22);
    g.globalAlpha = rnd(0.35, 0.8);
    g.drawImage(flare, Math.random() * w - s / 2, Math.random() * hgt - s / 2, s, s);
  }
  g.globalAlpha = 1;
}

function paintNear(near, glow, w, hgt, dpr) {
  for (const c of [near, glow]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(hgt * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const g = near.getContext('2d');
  const gl = glow.getContext('2d');
  const P = LAYER_PAD;
  const W = w - P * 2;
  const H = hgt - P * 2;

  // Light along the cave floor.
  const floorLight = gl.createLinearGradient(0, hgt, 0, hgt - H * 0.35);
  floorLight.addColorStop(0, 'rgba(139, 92, 246, 0.22)');
  floorLight.addColorStop(1, 'rgba(139, 92, 246, 0)');
  gl.fillStyle = floorLight;
  gl.fillRect(0, hgt - H * 0.35, w, H * 0.35);

  // Cave floor: an uneven rock ridge with small crystals poking out of it.
  const ridge = [];
  const a1 = rnd(0, 6);
  const a2 = rnd(0, 6);
  for (let x = -10; x <= w + 10; x += 14) {
    const u = x / w;
    ridge.push([x, hgt - P - H * (0.03 + 0.018 * Math.sin(u * 9 + a1) + 0.012 * Math.sin(u * 23 + a2)) + rnd(-2, 2)]);
  }
  for (let i = 0; i < ridge.length; i += 1) {
    if (Math.random() > 0.38) continue;
    const [x, y] = ridge[i];
    const len = rnd(7, 24);
    drawCrystal(g, x, y + 3, rnd(-0.55, 0.55), len, len * rnd(0.3, 0.4), Math.random() < 0.8 ? VIOLET : PINK, rnd(0.5, 1));
  }
  const rock = g.createLinearGradient(0, hgt - P - H * 0.07, 0, hgt);
  rock.addColorStop(0, '#160c29');
  rock.addColorStop(1, '#06030d');
  g.fillStyle = rock;
  g.beginPath();
  g.moveTo(ridge[0][0], hgt);
  for (const [x, y] of ridge) g.lineTo(x, y);
  g.lineTo(ridge[ridge.length - 1][0], hgt);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.35;
  g.strokeStyle = '#8b5cf6';
  g.lineWidth = 1;
  g.beginPath();
  ridge.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.globalAlpha = 1;

  const cluster = (cx, cy, size, dir, pal) => {
    const rot = dir < 0 ? 0 : Math.PI;
    const glowY = cy + dir * size * 0.42;
    const pool = gl.createRadialGradient(cx, glowY, 0, cx, glowY, size * 1.3);
    pool.addColorStop(0, `${pal[2]}70`);
    pool.addColorStop(0.45, `${pal[2]}26`);
    pool.addColorStop(1, `${pal[2]}00`);
    gl.fillStyle = pool;
    gl.fillRect(cx - size * 1.3, glowY - size * 1.3, size * 2.6, size * 2.6);

    const n = 7 + ((Math.random() * 5) | 0);
    const crystals = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1 + rnd(-0.15, 0.15);
      const len = size * (1 - Math.abs(t) * 0.5) * rnd(0.62, 1);
      crystals.push({ x: cx + t * size * 0.36 + rnd(-6, 6), y: cy + rnd(-4, 4), angle: rot + t * 0.78 + rnd(-0.12, 0.12), len, wid: Math.max(6, len * rnd(0.26, 0.34)), depth: rnd(0.45, 1) });
    }
    for (let i = 0; i < 5; i++) {
      const t = rnd(-1, 1);
      const len = size * rnd(0.16, 0.3);
      crystals.push({ x: cx + t * size * 0.5, y: cy + rnd(-2, 4), angle: rot + t * 1.05, len, wid: len * 0.38, depth: 1 });
    }
    crystals.sort((a, b) => a.depth - b.depth);
    for (const c of crystals) drawCrystal(g, c.x, c.y, c.angle, c.len, c.wid, pal, c.depth);

    // Host rock in front of the crystal bases, sunk into the floor (or ceiling) it grows from, with
    // light from the crystals catching its upper rim.
    const rx = size * 0.58;
    const ry = size * 0.13;
    const rockY = cy - dir * ry * 0.1;
    const base = g.createLinearGradient(0, rockY + dir * ry, 0, rockY - dir * ry);
    base.addColorStop(0, '#07040e');
    base.addColorStop(1, '#1a0f2e');
    g.fillStyle = base;
    const pts = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = rnd(0.84, 1.06);
      pts.push([cx + Math.cos(a) * rx * r, rockY + Math.sin(a) * ry * r]);
    }
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.globalAlpha = 0.45;
    g.strokeStyle = pal[2];
    g.lineWidth = 1.2;
    g.beginPath();
    // The half facing the crystals: angles π…2π (upper rim) for floor clusters, 0…π for hanging ones.
    const lit = pts.filter((_, i) => (dir < 0 ? i >= 11 : i <= 11));
    lit.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.globalAlpha = 1;
  };

  const floorY = hgt - P - H * 0.035;
  cluster(P + W * 0.05, floorY + 6, H * 0.3, -1, VIOLET);
  cluster(P + W * 0.95, floorY + 8, H * 0.36, -1, VIOLET);
  cluster(P + W * 0.37, floorY + 4, H * 0.12, -1, PINK);
  cluster(P + W * 0.63, floorY + 4, H * 0.1, -1, ICE);
  cluster(P + W * 0.79, P + 8, H * 0.15, 1, VIOLET);
  cluster(P + W * 0.23, P + 4, H * 0.09, 1, PINK);
}

// ───────────────────────── the scene

export function startBackground(scene) {
  const el = (tag, cls, parent = scene) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    parent.append(e);
    return e;
  };
  const farWrap = el('div', 'layer far');
  const farCanvas = el('canvas', '', farWrap);
  const aurora = el('div', 'aurora');
  for (let i = 0; i < 4; i++) el('span', '', aurora);
  const rays = el('div', 'rays');
  for (let i = 0; i < 5; i++) el('i', '', rays);
  const glowWrap = el('div', 'layer glow');
  const glowCanvas = el('canvas', '', glowWrap);
  const live = el('canvas', 'live');
  const nearWrap = el('div', 'layer near');
  const nearCanvas = el('canvas', '', nearWrap);
  el('div', 'vignette');
  el('div', 'grain');
  scene.style.setProperty('--grain', `url("${grainUrl()}")`);
  const top = el('canvas', 'fx-top', document.body);
  top.setAttribute('aria-hidden', 'true');

  const ctx = live.getContext('2d');
  const tctx = top.getContext('2d');
  let topDirty = false;
  const sp = {
    shards: [VIOLET, PINK, ICE].map((p) => [shardSprite(46, p), shardSprite(30, p), shardSprite(18, p)]),
    motes: ['#c4b5fd', '#f9a8d4', '#7dd3fc'].map((c) => glowSprite(9, c, 0.18)),
    sparkle: sparkleSprite(28, '#ffffff'),
    sparkleViolet: sparkleSprite(28, '#ddd6fe'),
    cursor: glowSprite(230, '#8b5cf6', 0.05),
    streak: streakSprite(220, '#e9d5ff'),
    ring: ringSprite(64, '#c4b5fd'),
  };

  let W = 0;
  let H = 0;
  let dpr = 1;
  let shards = [];
  let stars = [];
  let motes = [];
  const particles = [];
  const rings = [];
  let meteor = null;
  let nextMeteor = 0;
  const pointer = { x: 0, y: 0, lx: 0, ly: 0, nx: 0, ny: 0, px: 0, py: 0, inside: false, light: 0 };
  let raf = 0;
  let last = 0;
  let running = false;
  let focused = document.hasFocus();
  let gameRunning = false;
  let frameCost = 0;
  let frames = 0;
  const fpsWindow = { start: 0, frames: 0, fps: 0 };
  let paintTimer = 0;
  const applied = { far: '', near: '', glow: '' };

  function spawnShard(anywhere) {
    const z = Math.random();
    const tier = z > 0.75 ? 0 : z > 0.4 ? 1 : 2;
    const color = Math.random() < 0.7 ? 0 : Math.random() < 0.6 ? 1 : 2;
    return {
      x: rnd(0, W), y: anywhere ? rnd(0, H) : H + 70, z, img: sp.shards[color][tier],
      vy: -(0.1 + z * 0.32), vx: rnd(-0.05, 0.05), rot: rnd(-0.6, 0.6), vr: rnd(-0.0025, 0.0025),
      alpha: 0.2 + z * 0.5, phase: rnd(0, Math.PI * 2), glintSpeed: rnd(0.0004, 0.0009), glint: 0,
    };
  }

  function populate() {
    const area = W * H;
    shards = Array.from({ length: Math.round(Math.min(32, Math.max(14, area / 34000))) }, () => spawnShard(true));
    stars = Array.from({ length: Math.round(Math.min(70, Math.max(30, area / 16000))) }, () => ({
      x: rnd(0, W), y: rnd(0, H) * (Math.random() < 0.7 ? 0.75 : 1), size: rnd(7, 16), base: rnd(0.5, 1),
      speed: rnd(0.0006, 0.0018), phase: rnd(0, Math.PI * 2), img: Math.random() < 0.5 ? sp.sparkle : sp.sparkleViolet,
    }));
    motes = Array.from({ length: Math.round(Math.min(56, Math.max(24, area / 22000))) }, () => ({
      x: rnd(0, W), y: rnd(0, H), vx: 0, vy: 0, speed: rnd(0.15, 0.4), a: rnd(0.35, 0.85), size: rnd(8, 18),
      pulse: rnd(0.0008, 0.002), seed: rnd(0, 100), img: sp.motes[Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2],
    }));
  }

  function paintStatic() {
    const lw = W + LAYER_PAD * 2;
    const lh = H + LAYER_PAD * 2;
    paintFar(farCanvas, lw, lh, Math.min(dpr, 1.25));
    paintNear(nearCanvas, glowCanvas, lw, lh, Math.min(dpr, 1.5));
  }

  function resize(first) {
    dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    W = window.innerWidth;
    H = window.innerHeight;
    live.width = Math.round(W * dpr);
    live.height = Math.round(H * dpr);
    top.width = live.width;
    top.height = live.height;
    populate();
    clearTimeout(paintTimer);
    if (first) paintStatic();
    else paintTimer = setTimeout(paintStatic, 160);
    if (!running) drawFrame(performance.now(), 0);
  }

  function setLayer(wrap, key, x, y) {
    const v = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (applied[key] === v) return;
    applied[key] = v;
    wrap.style.transform = v;
  }

  function drawFrame(t, dt) {
    // Parallax and cursor light follow the pointer with easing.
    pointer.px += (pointer.nx - pointer.px) * Math.min(1, 0.05 * dt);
    pointer.py += (pointer.ny - pointer.py) * Math.min(1, 0.05 * dt);
    pointer.lx += (pointer.x - pointer.lx) * Math.min(1, 0.16 * dt);
    pointer.ly += (pointer.y - pointer.ly) * Math.min(1, 0.16 * dt);
    pointer.light += ((pointer.inside ? 1 : 0) - pointer.light) * Math.min(1, 0.06 * dt);
    setLayer(farWrap, 'far', pointer.px * -10, pointer.py * -7);
    setLayer(nearWrap, 'near', pointer.px * -26, pointer.py * -16);
    setLayer(glowWrap, 'glow', pointer.px * -26, pointer.py * -16);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Shards (normal blending).
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      s.y += s.vy * dt;
      s.x += (s.vx + Math.sin(t / 2400 + s.phase) * 0.05) * dt;
      s.rot += s.vr * dt;
      if (s.y < -90) shards[i] = spawnShard(false);
      s.sx = s.x + pointer.px * s.z * 30;
      s.sy = s.y + pointer.py * s.z * 20;
      s.glint = Math.max(0, Math.sin(t * s.glintSpeed + s.phase)) ** 40;
      ctx.globalAlpha = s.alpha * (0.85 + 0.15 * Math.sin(t / 900 + s.phase));
      ctx.setTransform(dpr * Math.cos(s.rot), dpr * Math.sin(s.rot), -dpr * Math.sin(s.rot), dpr * Math.cos(s.rot), s.sx * dpr, s.sy * dpr);
      ctx.drawImage(s.img, -s.img.width / 2, -s.img.height / 2);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Light (additive blending).
    ctx.globalCompositeOperation = 'lighter';
    if (pointer.light > 0.02) {
      ctx.globalAlpha = 0.16 * pointer.light;
      ctx.drawImage(sp.cursor, pointer.lx - sp.cursor.width / 2, pointer.ly - sp.cursor.height / 2);
    }
    for (const s of stars) {
      const tw = (0.5 + 0.5 * Math.sin(t * s.speed + s.phase)) ** 8;
      if (tw < 0.02) continue;
      const size = s.size * (0.55 + 0.45 * tw);
      ctx.globalAlpha = s.base * tw;
      ctx.drawImage(s.img, s.x + pointer.px * -6 - size / 2, s.y + pointer.py * -4 - size / 2, size, size);
    }
    const R = 150;
    for (const m of motes) {
      const a = Math.sin(m.x * 0.0023 + t * 0.00011 + m.seed) * 1.6 + Math.cos(m.y * 0.0029 - t * 0.00009) * 1.4;
      m.vx += (Math.cos(a) * m.speed - m.vx) * 0.02 * dt;
      m.vy += (Math.sin(a) * m.speed - 0.12 - m.vy) * 0.02 * dt;
      if (pointer.inside) {
        const dx = m.x - pointer.lx;
        const dy = m.y - pointer.ly;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / R) ** 2 * 0.9;
          m.vx += (dx / d) * f * dt;
          m.vy += (dy / d) * f * dt;
        }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < -30) m.x = W + 30;
      else if (m.x > W + 30) m.x = -30;
      if (m.y < -30) m.y = H + 30;
      else if (m.y > H + 30) m.y = -30;
      ctx.globalAlpha = m.a * (0.5 + 0.5 * Math.sin(t * m.pulse + m.seed));
      ctx.drawImage(m.img, m.x - m.size / 2, m.y - m.size / 2, m.size, m.size);
    }
    for (const s of shards) {
      if (s.glint < 0.03) continue;
      // The upper tip sits 0.8 × length (≈ 0.29 × sprite height) above the sprite centre.
      const size = 34 * (s.img.width / 70) * (0.6 + s.glint);
      const tipX = s.sx + Math.sin(s.rot) * s.img.height * 0.29;
      const tipY = s.sy - Math.cos(s.rot) * s.img.height * 0.29;
      ctx.globalAlpha = s.glint * s.alpha * 1.6;
      ctx.drawImage(sp.sparkle, tipX - size / 2, tipY - size / 2, size, size);
    }
    if (!meteor && t > nextMeteor && dt > 0) {
      const angle = Math.PI - rnd(0.35, 0.6);
      meteor = { x: rnd(W * 0.35, W * 1.05), y: rnd(-20, H * 0.3), angle, speed: rnd(13, 18), life: 0, max: rnd(850, 1250) };
    }
    if (meteor) {
      meteor.x += Math.cos(meteor.angle) * meteor.speed * dt;
      meteor.y += Math.sin(meteor.angle) * meteor.speed * dt;
      meteor.life += dt * 16.67;
      ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, meteor.life / meteor.max)) * 0.9;
      ctx.save();
      ctx.translate(meteor.x, meteor.y);
      ctx.rotate(meteor.angle);
      ctx.drawImage(sp.streak, -sp.streak.width, -sp.streak.height / 2);
      ctx.restore();
      if (meteor.life >= meteor.max) {
        meteor = null;
        nextMeteor = t + rnd(5000, 12000);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawBursts(dt);
  }

  /** Bursts live on their own canvas above the UI, touched only while particles exist. */
  function drawBursts(dt) {
    if (!particles.length && !rings.length) {
      if (topDirty) {
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.clearRect(0, 0, top.width, top.height);
        topDirty = false;
      }
      return;
    }
    topDirty = true;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, W, H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt * 16.67;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vx *= 0.965 ** dt;
      p.vy = p.vy * 0.965 ** dt + 0.06 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    tctx.globalCompositeOperation = 'source-over';
    for (const p of particles) {
      if (!p.chip) continue;
      tctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.4);
      tctx.save();
      tctx.translate(p.x, p.y);
      tctx.rotate(p.rot);
      tctx.drawImage(p.img, (-p.img.width * p.scale) / 2, (-p.img.height * p.scale) / 2, p.img.width * p.scale, p.img.height * p.scale);
      tctx.restore();
    }
    tctx.globalCompositeOperation = 'lighter';
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life += dt * 16.67;
      const k = r.life / r.max;
      if (k >= 1) {
        rings.splice(i, 1);
        continue;
      }
      const size = r.size * (0.2 + (1 - (1 - k) ** 3) * 0.8);
      tctx.globalAlpha = (1 - k) * 0.9;
      tctx.drawImage(sp.ring, r.x - size / 2, r.y - size / 2, size, size);
    }
    for (const p of particles) {
      if (p.chip) continue;
      const size = p.size * (0.4 + 0.6 * (p.life / p.max));
      tctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      tctx.drawImage(p.img, p.x - size / 2, p.y - size / 2, size, size);
    }
    tctx.globalCompositeOperation = 'source-over';
    tctx.globalAlpha = 1;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    // Half rate in the background or behind a dialog (the scene is blurred there anyway).
    const gap = 1000 / (focused && !document.body.classList.contains('modal-open') ? FPS_FOCUSED : FPS_BACKGROUND);
    if (t - last < gap - 1.5) return;
    // Up to 100 ms of simulated time per frame: slow machines stay in real time, a stall doesn't teleport.
    const dt = Math.min(6, (t - last) / 16.67);
    last = t;
    const t0 = performance.now();
    drawFrame(t, dt);
    frameCost = frameCost * 0.92 + (performance.now() - t0) * 0.08;
    frames++;
    if (t - fpsWindow.start >= 1000) {
      fpsWindow.fps = Math.round(((frames - fpsWindow.frames) * 1000) / (t - fpsWindow.start));
      fpsWindow.start = t;
      fpsWindow.frames = frames;
    }
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    if (!nextMeteor) nextMeteor = last + 2500;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const shouldRun = () => !document.hidden && !reduced.matches && !document.body.classList.contains('calm') && !(gameRunning && !focused);
  const update = () => (shouldRun() ? start() : stop());

  window.addEventListener('resize', () => resize(false));
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = e.clientX / Math.max(1, W) - 0.5;
    pointer.ny = e.clientY / Math.max(1, H) - 0.5;
    if (!pointer.inside) {
      pointer.inside = true;
      pointer.lx = e.clientX;
      pointer.ly = e.clientY;
    }
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => (pointer.inside = false));
  // A small sparkle where the empty background is clicked.
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a, input, select, textarea, label, .card, .modal, .titlebar, .sidebar, .toast')) return;
    api.burst(e.clientX, e.clientY, { count: 10, power: 0.55, chips: false, ring: false });
  }, { passive: true });
  window.addEventListener('focus', () => {
    focused = true;
    update();
  });
  window.addEventListener('blur', () => {
    focused = false;
    update();
  });
  document.addEventListener('visibilitychange', update);
  reduced.addEventListener('change', update);

  const api = {
    update,
    stop,
    burst(x, y, { count = 28, power = 1, chips = true, ring = true } = {}) {
      if (!running) return;
      if (ring) rings.push({ x, y, size: 220 * power, life: 0, max: 700 });
      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const a = rnd(0, Math.PI * 2);
        const v = rnd(1.5, 6) * power;
        const chip = chips && Math.random() < 0.4;
        const max = rnd(700, 1300);
        particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5 * power, rot: rnd(0, 6), vr: rnd(-0.15, 0.15), life: max, max, chip,
          img: chip ? sp.shards[(Math.random() * 3) | 0][2] : Math.random() < 0.5 ? sp.sparkle : sp.motes[(Math.random() * 3) | 0],
          size: rnd(8, 20), scale: rnd(0.45, 0.8),
        });
      }
    },
    setGameRunning(value) {
      gameRunning = !!value;
      update();
    },
    stats: () => ({ running, focused, gameRunning, frames, fps: fpsWindow.fps, frameCostMs: Number(frameCost.toFixed(3)), particles: particles.length, shards: shards.length, motes: motes.length, stars: stars.length }),
  };

  resize(true);
  update();
  active = api;
  return api;
}

// Generación procedural de texturas en canvas (sin assets externos = carga instantánea).
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor tileable
function makeNoise(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function fbm(size, seed, octaves = [4, 8, 16, 32], weights = [0.5, 0.25, 0.15, 0.1]) {
  const out = new Float32Array(size * size);
  octaves.forEach((c, i) => {
    const n = makeNoise(size, c, seed + i * 101);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * weights[i];
  });
  return out;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function applyNoise(ctx, size, noise, base, amp, grain, seed) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const n = (noise[i] - 0.5) * amp + (r() - 0.5) * grain;
    d[i * 4] = Math.max(0, Math.min(255, d[i * 4] * (1 + n) + base * n));
    d[i * 4 + 1] = Math.max(0, Math.min(255, d[i * 4 + 1] * (1 + n) + base * n));
    d[i * 4 + 2] = Math.max(0, Math.min(255, d[i * 4 + 2] * (1 + n) + base * n));
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Mapa de relieve en escala de grises a partir del canvas de color
function bumpFrom(c) {
  const size = c.width;
  const b = canvas(size);
  const ctx = b.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(b, false);
}

const S = 512;

function concrete(seed = 1, tint = [128, 126, 120]) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${tint.join(',')})`; ctx.fillRect(0, 0, S, S);
  applyNoise(ctx, S, fbm(S, seed), 20, 0.55, 0.18, seed);
  const r = rng(seed + 7);
  // manchas
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 10 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(40,38,34,${0.12 + r() * 0.14})`); g.addColorStop(1, 'rgba(40,38,34,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // grietas finas
  ctx.strokeStyle = 'rgba(30,30,30,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = r() * S, y = r() * S; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // juntas de panel
  ctx.strokeStyle = 'rgba(25,25,25,0.4)'; ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, S - 2, S - 2);
  return c;
}

function asphalt(seed = 3) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(74,72,68)'; ctx.fillRect(0, 0, S, S);
  applyNoise(ctx, S, fbm(S, seed, [8, 16, 64, 128], [0.4, 0.3, 0.2, 0.1]), 10, 0.5, 0.45, seed);
  const r = rng(seed + 2);
  for (let i = 0; i < 18; i++) {
    const x = r() * S, y = r() * S, rad = 30 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dirt = r() > 0.5;
    g.addColorStop(0, dirt ? 'rgba(110,92,64,0.22)' : 'rgba(20,20,20,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

function bricks(seed = 5) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,116,108)'; ctx.fillRect(0, 0, S, S);
  const r = rng(seed);
  const bh = S / 16, bw = S / 4;
  for (let row = 0; row < 16; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const v = 120 + r() * 50;
      ctx.fillStyle = `rgb(${v * 1.05 | 0},${v * 0.55 | 0},${v * 0.42 | 0})`;
      ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  applyNoise(ctx, S, fbm(S, seed), 10, 0.4, 0.2, seed);
  return c;
}

function metalCorrugated(seed, color) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 32) {
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 32, S);
  }
  applyNoise(ctx, S, fbm(S, seed), 8, 0.35, 0.1, seed);
  const r = rng(seed + 9);
  // óxido
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, rad = 4 + r() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(110,55,25,0.5)'); g.addColorStop(1, 'rgba(110,55,25,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

function crate(seed = 11) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,112,66)'; ctx.fillRect(0, 0, S, S);
  const r = rng(seed);
  // tablones
  for (let i = 0; i < 6; i++) {
    const v = 0.85 + r() * 0.3;
    ctx.fillStyle = `rgba(${150 * v | 0},${110 * v | 0},${64 * v | 0},1)`;
    ctx.fillRect(0, i * S / 6 + 2, S, S / 6 - 4);
  }
  // vetas
  ctx.strokeStyle = 'rgba(70,45,20,0.25)';
  for (let i = 0; i < 120; i++) {
    const y = r() * S; ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    ctx.stroke();
  }
  // marco y cruz
  ctx.fillStyle = 'rgb(118,84,46)';
  const f = 46;
  ctx.fillRect(0, 0, S, f); ctx.fillRect(0, S - f, S, f); ctx.fillRect(0, 0, f, S); ctx.fillRect(S - f, 0, f, S);
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(Math.PI / 4);
  ctx.fillRect(-S * 0.7, -f / 2, S * 1.4, f); ctx.restore();
  ctx.strokeStyle = 'rgba(40,25,10,0.6)'; ctx.lineWidth = 3;
  ctx.strokeRect(f, f, S - f * 2, S - f * 2); ctx.strokeRect(1, 1, S - 2, S - 2);
  // clavos
  ctx.fillStyle = 'rgba(40,40,40,0.9)';
  for (const [x, y] of [[23, 23], [S - 23, 23], [23, S - 23], [S - 23, S - 23]]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
  applyNoise(ctx, S, fbm(S, seed), 6, 0.3, 0.12, seed);
  return c;
}

function tiles(seed = 13) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(60,60,58)'; ctx.fillRect(0, 0, S, S);
  const r = rng(seed); const n = 4, t = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 140 + r() * 25;
    ctx.fillStyle = `rgb(${v | 0},${v * 0.98 | 0},${v * 0.92 | 0})`;
    ctx.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
  }
  applyNoise(ctx, S, fbm(S, seed), 6, 0.3, 0.1, seed);
  return c;
}

function plaster(seed = 17, col = [176, 168, 150]) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${col.join(',')})`; ctx.fillRect(0, 0, S, S);
  applyNoise(ctx, S, fbm(S, seed), 12, 0.35, 0.12, seed);
  // franja inferior sucia
  const g = ctx.createLinearGradient(0, S, 0, S * 0.7);
  g.addColorStop(0, 'rgba(60,50,40,0.35)'); g.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, S * 0.7, S, S * 0.3);
  return c;
}

function sandbag(seed = 19) {
  const c = canvas(S); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(140,122,88)'; ctx.fillRect(0, 0, S, S);
  const rows = 4, h = S / rows;
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? S / 4 : 0;
    for (let i = -1; i < 3; i++) {
      const x = i * S / 2 + off;
      const g = ctx.createRadialGradient(x + S / 4, row * h + h / 2, 10, x + S / 4, row * h + h / 2, S / 3.2);
      g.addColorStop(0, 'rgb(158,140,104)'); g.addColorStop(1, 'rgb(92,78,52)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x + 3, row * h + 3, S / 2 - 6, h - 6, 24); ctx.fill();
    }
  }
  applyNoise(ctx, S, fbm(S, seed, [16, 32, 64, 128]), 8, 0.35, 0.35, seed);
  return c;
}

function barrel() {
  const c = canvas(256); const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(160,32,24)'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgb(110,20,16)';
  for (const y of [20, 118, 216]) ctx.fillRect(0, y, 256, 18);
  ctx.fillStyle = 'rgb(230,190,30)'; ctx.fillRect(0, 70, 256, 26);
  ctx.fillStyle = '#111';
  for (let x = -20; x < 256; x += 30) { ctx.beginPath(); ctx.moveTo(x, 96); ctx.lineTo(x + 14, 70); ctx.lineTo(x + 28, 70); ctx.lineTo(x + 14, 96); ctx.fill(); }
  applyNoise(ctx, 256, fbm(256, 23), 8, 0.35, 0.12, 23);
  return c;
}

function bulletHole() {
  const c = canvas(64); const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.18, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.35, 'rgba(40,34,28,0.6)'); g.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, true, false);
}

function flare() {
  const c = canvas(128); const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.2, 'rgba(255,210,120,0.9)');
  g.addColorStop(0.5, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  // puntas de estrella
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,220,150,0.7)';
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.translate(64, 64); ctx.rotate(i * Math.PI / 3 + 0.2);
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(62, 0); ctx.lineTo(0, 5); ctx.fill(); ctx.restore();
  }
  return toTexture(c, true, false);
}

function scorch() {
  const c = canvas(128); const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.6, 'rgba(15,12,10,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, true, false);
}

let cache = null;

export function getTextures() {
  if (cache) return cache;
  const mk = (cnv, bump = true) => ({ map: toTexture(cnv), bump: bump ? bumpFrom(cnv) : null });
  cache = {
    concrete: mk(concrete(1)),
    concreteDark: mk(concrete(2, [96, 96, 98])),
    asphalt: mk(asphalt(3)),
    bricks: mk(bricks(5)),
    containerRed: mk(metalCorrugated(31, 'rgb(140,46,34)')),
    containerBlue: mk(metalCorrugated(32, 'rgb(36,72,110)')),
    containerGreen: mk(metalCorrugated(33, 'rgb(58,96,58)')),
    containerYellow: mk(metalCorrugated(34, 'rgb(176,136,40)')),
    crate: mk(crate(11)),
    tiles: mk(tiles(13)),
    plaster: mk(plaster(17)),
    plasterBlue: mk(plaster(18, [120, 140, 150])),
    sandbag: mk(sandbag(19)),
    barrel: mk(barrel(), false),
    bulletHole: bulletHole(),
    flare: flare(),
    scorch: scorch(),
  };
  return cache;
}

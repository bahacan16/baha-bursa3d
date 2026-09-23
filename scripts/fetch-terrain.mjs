#!/usr/bin/env node
// Gerçek yükseklik verisi: AWS Terrain Tiles (Terrarium PNG, açık veri) → public/data/terrain.bin
// İki ızgara: yakın (merkez ± 1300 m, 10 m hücre) ve uzak (merkez ± 32 km, 400 m hücre — Uludağ silüeti).
// Kullanım: node scripts/fetch-terrain.mjs   (merkez public/data/meta.json'dan okunur)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CENTER_LITE, unproject } from '../src/worlds/osm/simplify.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Minimal PNG çözücü: 8 bit RGB/RGBA, interlace yok (Terrarium karoları). */
function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('Desteklenmeyen PNG');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG renk tipi ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const cache = new Map();
async function tile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!cache.has(k)) {
    cache.set(
      k,
      (async () => {
        for (let a = 0; a < 3; a++) {
          try {
            const res = await fetch(TILE_URL(z, x, y), { signal: AbortSignal.timeout(30000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return decodePng(Buffer.from(await res.arrayBuffer()));
          } catch (e) {
            if (a === 2) throw e;
            await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
          }
        }
      })(),
    );
  }
  return cache.get(k);
}

/** lat/lon → yükseklik (m), karo içinde çift doğrusal. */
async function elevation(lat, lon, z) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n * 256;
  const latR = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
  const sample = async (px, py) => {
    const tx = Math.floor(px / 256);
    const ty = Math.floor(py / 256);
    const t = await tile(z, tx, ty);
    const ix = Math.min(255, Math.max(0, Math.floor(px - tx * 256)));
    const iy = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
    const o = (iy * t.w + ix) * t.bpp;
    return t.px[o] * 256 + t.px[o + 1] + t.px[o + 2] / 256 - 32768;
  };
  const x0 = Math.floor(fx - 0.5);
  const y0 = Math.floor(fy - 0.5);
  const dx = fx - 0.5 - x0;
  const dy = fy - 0.5 - y0;
  const [a, b, c, d] = await Promise.all([
    sample(x0, y0),
    sample(x0 + 1, y0),
    sample(x0, y0 + 1),
    sample(x0 + 1, y0 + 1),
  ]);
  return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy;
}

async function grid(center, half, cell, z) {
  const n = Math.round((half * 2) / cell) + 1;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const ll = unproject(-half + i * cell, -half + j * cell, center);
      rows.push(elevation(ll.lat, ll.lon, z));
    }
    const vals = await Promise.all(rows);
    h.set(vals, j * n);
  }
  return { n, half, cell, h };
}

async function main() {
  let center = DEFAULT_CENTER_LITE;
  try {
    center = JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8')).center ?? center;
  } catch {
    console.warn('⚠ meta.json yok; varsayılan merkez kullanılıyor.');
  }
  console.log('merkez', center);
  const near = await grid(center, 1300, 10, 14);
  const far = await grid(center, 32000, 400, 10);
  // Biçim: "TRN1" | yakın(n, half, cell) | uzak(n, half, cell) | yakın Float32[] | uzak Float32[] (küçük uçlu)
  const head = Buffer.alloc(4 + 6 * 4);
  head.write('TRN1', 0, 'ascii');
  [near.n, near.half, near.cell, far.n, far.half, far.cell].forEach((v, i) =>
    head.writeFloatLE(v, 4 + i * 4),
  );
  const body = Buffer.concat([head, Buffer.from(near.h.buffer), Buffer.from(far.h.buffer)]);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'terrain.bin'), body);
  const c = near.h[((near.n - 1) / 2) * near.n + (near.n - 1) / 2];
  let min = Infinity;
  let max = -Infinity;
  for (const v of near.h) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  let fmax = -Infinity;
  for (const v of far.h) fmax = Math.max(fmax, v);
  console.log(
    `✓ terrain.bin ${(body.length / 1e6).toFixed(2)} MB — merkez ${c.toFixed(1)} m, yakın alan ${min.toFixed(0)}–${max.toFixed(0)} m, uzak zirve ${fmax.toFixed(0)} m`,
  );
}

main().catch((e) => {
  console.error('✗ Arazi verisi alınamadı:', e.message);
  process.exit(1);
});

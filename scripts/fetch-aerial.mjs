#!/usr/bin/env node
// Hava fotoğrafı (Esri World Imagery) → oyunun yerel ENU ızgarasına yeniden örneklenmiş JPG.
// Kişisel/hobi kullanım. Geliştirme ortamı Esri'ye erişemediği için Actions'ta çalışır.
// Çıktı: public/data/aerial-4096.jpg, aerial-2048.jpg, aerial.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_CENTER_LITE, unproject } from '../src/worlds/osm/simplify.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');
const HALF = 1300;
const Z = Number(process.env.AERIAL_ZOOM ?? 18);
const N = 4096;
const URL_T = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const mercX = (lon) => ((lon + 180) / 360) * 256 * 2 ** Z;
const mercY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** Z;
};

async function fetchTile(x, y) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(URL_T(Z, x, y), {
        headers: { 'User-Agent': 'nilufer-walk/0.1 (personal)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== 256 || info.height !== 256) throw new Error('beklenmeyen karo boyutu');
      return data;
    } catch (e) {
      if (a === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
}

async function main() {
  let center = DEFAULT_CENTER_LITE;
  try {
    center = JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8')).center ?? center;
  } catch {
    console.warn('⚠ meta.json yok; varsayılan merkez');
  }
  // Kapsanan global piksel aralığı
  const nw = unproject(-HALF, -HALF, center);
  const se = unproject(HALF, HALF, center);
  const tx0 = Math.floor(mercX(nw.lon) / 256) - 1;
  const tx1 = Math.floor(mercX(se.lon) / 256) + 1;
  const ty0 = Math.floor(mercY(nw.lat) / 256) - 1;
  const ty1 = Math.floor(mercY(se.lat) / 256) + 1;
  const tw = tx1 - tx0 + 1;
  const th = ty1 - ty0 + 1;
  console.log(`z${Z}: ${tw}×${th} = ${tw * th} karo`);
  const W = tw * 256;
  const Hh = th * 256;
  const mosaic = Buffer.alloc(W * Hh * 3);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0;
  const worker = async () => {
    for (;;) {
      const j = jobs.shift();
      if (!j) return;
      const [tx, ty] = j;
      const data = await fetchTile(tx, ty);
      const ox = (tx - tx0) * 256;
      const oy = (ty - ty0) * 256;
      for (let r = 0; r < 256; r++)
        data.copy(mosaic, ((oy + r) * W + ox) * 3, r * 256 * 3, (r + 1) * 256 * 3);
      if (++done % 100 === 0) console.log(`  ${done}/${tw * th}`);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));

  // Yerel ızgaraya yeniden örnekle (satır 0 = kuzey = z −HALF; sütun 0 = batı)
  const out = Buffer.alloc(N * N * 3);
  const cell = (HALF * 2) / N;
  const gx0 = tx0 * 256;
  const gy0 = ty0 * 256;
  for (let j = 0; j < N; j++) {
    const z = -HALF + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const x = -HALF + (i + 0.5) * cell;
      const ll = unproject(x, z, center);
      const px = mercX(ll.lon) - gx0 - 0.5;
      const py = mercY(ll.lat) - gy0 - 0.5;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(px)));
      const y0 = Math.max(0, Math.min(Hh - 2, Math.floor(py)));
      const fx = px - x0;
      const fy = py - y0;
      const o = (j * N + i) * 3;
      for (let c = 0; c < 3; c++) {
        const a = mosaic[(y0 * W + x0) * 3 + c];
        const b = mosaic[(y0 * W + x0 + 1) * 3 + c];
        const d = mosaic[((y0 + 1) * W + x0) * 3 + c];
        const e = mosaic[((y0 + 1) * W + x0 + 1) * 3 + c];
        out[o + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  await mkdir(outDir, { recursive: true });
  const img = sharp(out, { raw: { width: N, height: N, channels: 3 } });
  await img.clone().jpeg({ quality: 86, mozjpeg: true }).toFile(join(outDir, 'aerial-4096.jpg'));
  await img
    .clone()
    .resize(2048, 2048)
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(join(outDir, 'aerial-2048.jpg'));
  await writeFile(
    join(outDir, 'aerial.json'),
    JSON.stringify(
      {
        source: 'Esri World Imagery',
        zoom: Z,
        half: HALF,
        size: N,
        center,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('✓ aerial-4096.jpg, aerial-2048.jpg');
}

main().catch((e) => {
  console.error('✗ Hava fotoğrafı alınamadı:', e.message);
  process.exit(1);
});

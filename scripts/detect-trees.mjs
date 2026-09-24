#!/usr/bin/env node
// Hava fotoğrafından ağaç tepesi tespiti → public/data/trees-aerial.json ([x, z, yarıçap]*)
// Yöntem: "aşırı yeşil" (ExG = 2G − R − B) ve koyu pikseller = ağaç tacı (çim daha açık/az doygun);
// taç yoğunluğu yüksek noktalara en az 4.5 m aralıkla ağaç yerleştirilir.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'data');
const meta = JSON.parse(await readFile(join(dir, 'aerial.json'), 'utf8'));
const HALF = meta.half;
const { data, info } = await sharp(join(dir, 'aerial-4096.jpg')).raw().toBuffer({ resolveWithObject: true });
const N = info.width;
const cell = (HALF * 2) / N;

// 1) Taç maskesi: yeşil + koyu + pürüzlü (yerel parlaklık varyansı yüksek; çim düzgündür)
const lumA = new Float32Array(N * N);
for (let i = 0, p = 0; i < N * N; i++, p += 3)
  lumA[i] = 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
const S1 = new Float64Array((N + 1) * (N + 1));
const S2 = new Float64Array((N + 1) * (N + 1));
for (let y = 0; y < N; y++) {
  let a = 0;
  let b2 = 0;
  for (let x = 0; x < N; x++) {
    const v = lumA[y * N + x];
    a += v;
    b2 += v * v;
    S1[(y + 1) * (N + 1) + x + 1] = S1[y * (N + 1) + x + 1] + a;
    S2[(y + 1) * (N + 1) + x + 1] = S2[y * (N + 1) + x + 1] + b2;
  }
}
const box = (S, x0, y0, x1, y1) =>
  S[y1 * (N + 1) + x1] - S[y0 * (N + 1) + x1] - S[y1 * (N + 1) + x0] + S[y0 * (N + 1) + x0];
const VR = 3;
const mask = new Uint8Array(N * N);
for (let y = VR; y < N - VR; y++)
  for (let x = VR; x < N - VR; x++) {
    const i = y * N + x;
    const p = i * 3;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const exg = 2 * g - r - b;
    if (exg < 14 || lumA[i] > 95 || g <= b) continue;
    const n = (2 * VR + 1) ** 2;
    const m1 = box(S1, x - VR, y - VR, x + VR + 1, y + VR + 1) / n;
    const m2 = box(S2, x - VR, y - VR, x + VR + 1, y + VR + 1) / n;
    const sd = Math.sqrt(Math.max(0, m2 - m1 * m1));
    if (sd > Number(process.env.TREE_SD ?? 11)) mask[i] = 1;
  }
// 2) Yoğunluk (integral görüntü) — 2.5 m yarıçaplı kare içindeki taç oranı
const I = new Uint32Array((N + 1) * (N + 1));
for (let y = 0; y < N; y++) {
  let row = 0;
  for (let x = 0; x < N; x++) {
    row += mask[y * N + x];
    I[(y + 1) * (N + 1) + x + 1] = I[y * (N + 1) + x + 1] + row;
  }
}
const sum = (x0, y0, x1, y1) =>
  I[y1 * (N + 1) + x1] - I[y0 * (N + 1) + x1] - I[y1 * (N + 1) + x0] + I[y0 * (N + 1) + x0];
const R = Math.max(2, Math.round(2.2 / cell));
const cands = [];
for (let y = R; y < N - R; y += 2)
  for (let x = R; x < N - R; x += 2) {
    if (!mask[y * N + x]) continue;
    const d = sum(x - R, y - R, x + R + 1, y + R + 1) / ((2 * R + 1) * (2 * R + 1));
    if (d > 0.45) cands.push([d, x, y]);
  }
cands.sort((a, b) => b[0] - a[0]);
// 3) En az 4.5 m aralıkla yerleştir (ızgara ile)
const minD = 4.5 / cell;
const G = new Map();
const out = [];
for (const [d, x, y] of cands) {
  const gx = Math.floor(x / minD);
  const gy = Math.floor(y / minD);
  let ok = true;
  for (let dx = -1; dx <= 1 && ok; dx++)
    for (let dy = -1; dy <= 1 && ok; dy++)
      for (const [px, py] of G.get(`${gx + dx},${gy + dy}`) ?? [])
        if (Math.hypot(px - x, py - y) < minD) ok = false;
  if (!ok) continue;
  const k = `${gx},${gy}`;
  if (!G.has(k)) G.set(k, []);
  G.get(k).push([x, y]);
  // Yarıçap: yoğunluğa göre 2–4 m
  const rad = 2 + 2 * Math.min(1, (d - 0.45) / 0.55);
  out.push(+(-HALF + (x + 0.5) * cell).toFixed(1), +(-HALF + (y + 0.5) * cell).toFixed(1), +rad.toFixed(1));
}
// Merkeze yakından uzağa sırala (kalite sınırı uygulanınca merkez korunur)
const idx = [];
for (let i = 0; i < out.length; i += 3) idx.push(i);
idx.sort((a, b) => Math.hypot(out[a], out[a + 1]) - Math.hypot(out[b], out[b + 1]));
const sorted = idx.flatMap((i) => [out[i], out[i + 1], out[i + 2]]);
await writeFile(
  join(dir, 'trees-aerial.json'),
  JSON.stringify({ source: 'aerial canopy detection', trees: sorted }),
);
console.log(`✓ ${out.length / 3} ağaç tespit edildi`);

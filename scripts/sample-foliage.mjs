#!/usr/bin/env node
// Yaprak rengi örnekleyici (docs/TREES.md "Tür anahtarları"): bir Street View karesinde / fotoğrafta dikdörtgen
// içindeki yaprak piksellerinden (gök, beyaz cephe, çok koyu gölge hariç) parlaklık sırasına göre güneşli (en parlak
// %15), orta (%40–60) ve gölge (%10–25) ortalama sRGB renkleri.
// Kullanım: node scripts/sample-foliage.mjs <kare.jpg> <x> <y> <w> <h> [green|purple|any|bark]
import sharp from 'sharp';

const [file, x, y, w, h, mode = 'green'] = process.argv.slice(2);
if (!file || h == null) {
  console.error(
    'Kullanım: node scripts/sample-foliage.mjs <kare.jpg> <x> <y> <w> <h> [green|purple|any|bark]',
  );
  process.exit(1);
}
const { data, info } = await sharp(file)
  .extract({ left: +x, top: +y, width: +w, height: +h })
  .raw()
  .toBuffer({ resolveWithObject: true });
const px = [];
for (let i = 0; i < data.length; i += info.channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // gökyüzü / beyaz cephe / çok koyu gölge dışarı
  if (b > r + 18 && b > g + 5) continue;
  if (L > 225 || L < 12) continue;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0;
  if (mode === 'green' && !(g >= r - 4 && g >= b && sat > 0.12)) continue;
  if (mode === 'purple' && !(r > g + 6 && sat > 0.1)) continue;
  if (mode === 'bark' && sat > 0.45) continue;
  px.push([r, g, b, L]);
}
px.sort((a, b) => a[3] - b[3]);
const n = px.length;
const band = (a, b) => {
  const s = px.slice(Math.floor(n * a), Math.max(Math.floor(n * a) + 1, Math.floor(n * b)));
  const m = [0, 0, 0];
  for (const p of s) for (let k = 0; k < 3; k++) m[k] += p[k] / s.length;
  return '#' + m.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};
console.log(
  file.split('/').pop(),
  `n=${n}`,
  'güneşli',
  band(0.85, 1),
  'orta',
  band(0.4, 0.6),
  'gölge',
  band(0.1, 0.25),
);

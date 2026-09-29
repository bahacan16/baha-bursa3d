#!/usr/bin/env node
// Ölçüm planı: Google hava fotoğrafı üzerine düzeltilmiş taban izi (sarı, kenar no + uzunluk, dış normal oku),
// OSM izi (turuncu ince) ve yakındaki panoramalar (kırmızı nokta, ilk 4 karakter).
// Not: hava fotoğrafında yüksek binalar eğik çekim nedeniyle kuzeybatıya yatık görünür (çatı tabandan kayık).
// Kullanım: node scripts/survey-plan-map.mjs <id> [pay=12] → docs/survey/maps/<id>.jpg
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const id = Number(process.argv[2]);
  const pad = Number(process.argv[3] ?? 12);
  const fp = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'mertkent', 'data', 'footprints.json'), 'utf8'),
  );
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const aidx = JSON.parse(await readFile(join(root, 'streetview-src', process.env.AERIAL_DIR || 'aerial', 'index.json'), 'utf8'));
  const im = aidx.images.find((i) => i.source === 'google');
  const ring = fp[id].ring;
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  const X0 = Math.min(...xs) - pad;
  const X1 = Math.max(...xs) + pad;
  const Z0 = Math.min(...zs) - pad;
  const Z1 = Math.max(...zs) + pad;
  const m = im.metersPerPixel;
  const ox = aidx.cx - aidx.half;
  const oz = aidx.cz - aidx.half;
  const OW = 1100;
  const S = OW / (X1 - X0);
  const OH = Math.round((Z1 - Z0) * S);
  const base = await sharp(join(root, 'streetview-src', process.env.AERIAL_DIR || 'aerial', im.file))
    .extract({
      left: Math.round((X0 - ox) / m),
      top: Math.round((Z0 - oz) / m),
      width: Math.round((X1 - X0) / m),
      height: Math.round((Z1 - Z0) / m),
    })
    .resize(OW, OH)
    .toBuffer();
  const tx = (x) => ((x - X0) * S).toFixed(1);
  const tz = (z) => ((z - Z0) * S).toFixed(1);
  let svg = `<svg width="${OW}" height="${OH}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">`;
  for (let g = Math.ceil(X0 / 5) * 5; g <= X1; g += 5)
    svg +=
      `<line x1="${tx(g)}" y1="0" x2="${tx(g)}" y2="${OH}" stroke="#fff" stroke-opacity="${g % 10 ? 0.08 : 0.25}"/>` +
      (g % 10 ? '' : `<text x="${+tx(g) + 2}" y="12" font-size="11" fill="#ff0">x${g}</text>`);
  for (let g = Math.ceil(Z0 / 5) * 5; g <= Z1; g += 5)
    svg +=
      `<line x1="0" y1="${tz(g)}" x2="${OW}" y2="${tz(g)}" stroke="#fff" stroke-opacity="${g % 10 ? 0.08 : 0.25}"/>` +
      (g % 10 ? '' : `<text x="2" y="${+tz(g) - 2}" font-size="11" fill="#ff0">z${g}</text>`);
  const w = osm.ways.find((q) => q.i === id);
  if (w) {
    const d = [];
    for (let i = 0; i < w.p.length; i += 2) d.push(`${tx(w.p[i])},${tz(w.p[i + 1])}`);
    svg += `<polyline points="${d.join(' ')}" fill="none" stroke="#ff9000" stroke-width="1" stroke-dasharray="3 3"/>`;
  }
  svg += `<polygon points="${ring.map((p) => `${tx(p[0])},${tz(p[1])}`).join(' ')}" fill="none" stroke="#ffe000" stroke-width="2"/>`;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const e = ring[(i + 1) % ring.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    const nx = -(e[1] - a[1]) / L;
    const nz = (e[0] - a[0]) / L;
    const mx = (a[0] + e[0]) / 2;
    const mz = (a[1] + e[1]) / 2;
    svg += `<line x1="${tx(mx)}" y1="${tz(mz)}" x2="${tx(mx + nx * 1.5)}" y2="${tz(mz + nz * 1.5)}" stroke="#0ff" stroke-width="2"/>`;
    svg += `<text x="${tx(mx + nx * 2.8)}" y="${+tz(mz + nz * 2.8) + 4}" font-size="13" fill="#0ff" stroke="#000" stroke-width="0.4" text-anchor="middle">${i}:${L.toFixed(1)}</text>`;
    svg += `<circle cx="${tx(a[0])}" cy="${tz(a[1])}" r="3" fill="#ffe000"/>`;
  }
  for (const p of idx.panos) {
    if (p.date && p.date < '2020') continue;
    if (p.x < X0 || p.x > X1 || p.z < Z0 || p.z > Z1) continue;
    svg += `<circle cx="${tx(p.x)}" cy="${tz(p.z)}" r="4" fill="#f22"/><text x="${+tx(p.x) + 5}" y="${+tz(p.z) + 4}" font-size="11" fill="#fcc" stroke="#000" stroke-width="0.3">${p.id.slice(0, 4)}</text>`;
  }
  svg += `<text x="8" y="${OH - 8}" font-size="14" fill="#ffe000" stroke="#000" stroke-width="0.4">${id} — sarı: düzeltilmiş iz (kenar:uzunluk, ok = dış normal), turuncu kesikli: OSM</text></svg>`;
  await mkdir(join(root, 'docs', 'survey', 'maps'), { recursive: true });
  const out = join(root, 'docs', 'survey', 'maps', `${id}.jpg`);
  await sharp(base)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 86 })
    .toFile(out);
  console.log(out);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

#!/usr/bin/env node
// Site planı kontrolü: src/worlds/measured/data/site-plan.json + street-plan.json öğelerini Google z21 hava fotoğrafına çizer.
// Izgara 1 m (ince) / 5 m (etiketli). Taban izleri (footprints.json) sarı.
// Kullanım: node scripts/site-plan-overlay.mjs x0 z0 x1 z1 [genişlik=1400] [çıktı] [plan=0|1]
//   plan=0 → yalnızca hava fotoğrafı + ızgara (çizim öncesi okuma için)
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COL = {
  pool: '#00e0ff',
  deck: '#ffd27a',
  paving: '#ffb000',
  lawn: '#40ff40',
  asphalt: '#b0b0b0',
  playground: '#ff60ff',
  court: '#ff8040',
  bed: '#a0ff60',
  gravel: '#d0c0a0',
  structure: '#ff3030',
};

async function main() {
  const [X0, Z0, X1, Z1] = process.argv.slice(2, 6).map(Number);
  const OW = Number(process.argv[6] ?? 1400);
  const out = process.argv[7] ?? join(root, 'docs', 'survey', 'site', `ov_${X0}_${Z0}_${X1}_${Z1}.jpg`);
  const drawPlan = process.argv[8] !== '0';
  const aidx = JSON.parse(
    await readFile(join(root, 'streetview-src', process.env.AERIAL_DIR || 'aerial', 'index.json'), 'utf8'),
  );
  const im = aidx.images.find((i) => i.source === 'google');
  const m = im.metersPerPixel;
  const ox = aidx.cx - aidx.half;
  const oz = aidx.cz - aidx.half;
  const S = OW / (X1 - X0);
  const OH = Math.round((Z1 - Z0) * S);
  // Kırpma görüntü dışına taşarsa siyah dolgu (eskiden sessizce kenara kırpıyordu → x < −160'ta kayık çizim)
  const aerialFile = join(root, 'streetview-src', process.env.AERIAL_DIR || 'aerial', im.file);
  const meta = await sharp(aerialFile).metadata();
  const L = Math.round((X0 - ox) / m);
  const T = Math.round((Z0 - oz) / m);
  const W = Math.round((X1 - X0) / m);
  const Hh = Math.round((Z1 - Z0) / m);
  const pad = {
    left: Math.max(0, -L),
    top: Math.max(0, -T),
    right: Math.max(0, L + W - meta.width),
    bottom: Math.max(0, T + Hh - meta.height),
  };
  let src = sharp(aerialFile);
  if (pad.left || pad.top || pad.right || pad.bottom) {
    console.warn(
      '⚠ istenen alan hava fotoğrafının dışına taşıyor — dışı siyah (AERIAL_DIR başka karo olabilir)',
    );
    src = sharp(await src.extend({ ...pad, background: { r: 0, g: 0, b: 0 } }).toBuffer());
  }
  const base = await src
    .extract({ left: L + pad.left, top: T + pad.top, width: W, height: Hh })
    .resize(OW, OH)
    .toBuffer();
  const tx = (x) => ((x - X0) * S).toFixed(1);
  const tz = (z) => ((z - Z0) * S).toFixed(1);
  const pts = (p) => p.map((q) => `${tx(q[0])},${tz(q[1])}`).join(' ');
  let s = `<svg width="${OW}" height="${OH}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">`;
  for (let g = Math.ceil(X0); g <= X1; g++) {
    const major = g % 5 === 0;
    s += `<line x1="${tx(g)}" y1="0" x2="${tx(g)}" y2="${OH}" stroke="#fff" stroke-opacity="${major ? 0.35 : 0.1}"/>`;
    if (major)
      s += `<text x="${+tx(g) + 2}" y="12" font-size="11" fill="#ff0" stroke="#000" stroke-width="0.3">x${g}</text>`;
  }
  for (let g = Math.ceil(Z0); g <= Z1; g++) {
    const major = g % 5 === 0;
    s += `<line x1="0" y1="${tz(g)}" x2="${OW}" y2="${tz(g)}" stroke="#fff" stroke-opacity="${major ? 0.35 : 0.1}"/>`;
    if (major)
      s += `<text x="2" y="${+tz(g) - 2}" font-size="11" fill="#ff0" stroke="#000" stroke-width="0.3">z${g}</text>`;
  }
  const fp = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'measured', 'data', 'footprints.json'), 'utf8'),
  );
  for (const f of Object.values(fp))
    s += `<polygon points="${pts(f.ring)}" fill="none" stroke="#ffe000" stroke-width="1.5" stroke-dasharray="6 3"/>`;
  // OSM_IDS=a,b → OSM taban halkaları (camgöbeği) + köşe indeksleri
  if (process.env.OSM_IDS) {
    const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
    for (const id of process.env.OSM_IDS.split(',').map(Number)) {
      const w = osm.ways.find((q) => q.i === id);
      if (!w) continue;
      const r = [];
      for (let i = 0; i + 1 < w.p.length; i += 2) r.push([w.p[i], w.p[i + 1]]);
      s += `<polygon points="${pts(r)}" fill="none" stroke="#00ffff" stroke-width="1.5"/>`;
      r.forEach((q, i) => {
        s += `<text x="${tx(q[0])}" y="${tz(q[1])}" font-size="11" fill="#0ff" stroke="#000" stroke-width="0.4">${i}</text>`;
      });
    }
  }
  if (drawPlan) {
    const plan = {};
    for (const fn of ['site-plan.json', 'street-plan.json']) {
      try {
        const j = JSON.parse(await readFile(join(root, 'src', 'worlds', 'measured', 'data', fn), 'utf8'));
        for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) plan[k] = [...(plan[k] ?? []), ...v];
      } catch {
        /* henüz yok */
      }
    }
    for (const a of plan.areas ?? [])
      s += `<polygon points="${pts(a.poly)}" fill="${COL[a.kind] ?? '#fff'}" fill-opacity="0.18" stroke="${COL[a.kind] ?? '#fff'}" stroke-width="2"/>`;
    for (const st of plan.structures ?? [])
      s += `<polygon points="${pts(st.poly)}" fill="none" stroke="${COL.structure}" stroke-width="2.5"/>`;
    for (const l of plan.lines ?? [])
      s += `<polyline points="${pts(l.pts)}" fill="none" stroke="${l.kind === 'hedge' ? '#00ff90' : l.kind === 'kerb' ? '#ffffff' : '#ff9090'}" stroke-width="2.5"/>`;
    for (const f of plan.fence ?? [])
      s += `<polyline points="${pts(f.pts)}" fill="none" stroke="#ff2020" stroke-width="3"/>`;
    for (const w of plan.sidewalks ?? [])
      s += `<polyline points="${pts(w.pts)}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="8 4"/>`;
    for (const g of plan.gates ?? [])
      s += `<circle cx="${tx(g.c[0])}" cy="${tz(g.c[1])}" r="${(g.w / 2) * S}" fill="none" stroke="#ff00ff" stroke-width="3"/>`;
    for (const p of [...(plan.points ?? []), ...(plan.street ?? [])]) {
      const r = Math.max(3, (p.r ?? 0.3) * S);
      const c =
        p.kind === 'tree'
          ? '#30ff30'
          : p.kind === 'shrub'
            ? '#90ff90'
            : p.kind === 'car'
              ? '#ff4040'
              : '#ffffff';
      s += `<circle cx="${tx(p.x)}" cy="${tz(p.z)}" r="${r}" fill="none" stroke="${c}" stroke-width="2"/>`;
      s += `<text x="${+tx(p.x) + r + 2}" y="${+tz(p.z) + 4}" font-size="10" fill="${c}" stroke="#000" stroke-width="0.3">${p.kind}</text>`;
    }
  }
  s += '</svg>';
  await mkdir(dirname(out), { recursive: true });
  await sharp(base)
    .composite([{ input: Buffer.from(s), left: 0, top: 0 }])
    .jpeg({ quality: 86 })
    .toFile(out);
  console.log(out, OW, OH);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

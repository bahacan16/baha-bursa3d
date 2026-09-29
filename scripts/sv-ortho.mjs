#!/usr/bin/env node
// Cephe ortofotoları: aynı panoramadan çekilmiş 40°'lik karoları cephe düzlemine projekte edip birleştirir.
// Çıktı (repoda değil, yerel ölçüm için): docs/survey/<bina>_<kenar>_<pano8>.jpg (+ _grid.jpg: 1 m ızgara, 5 m etiket)
// Kullanım: node scripts/sv-ortho.mjs [binaId,...]   (PX_PER_M=40, MARGIN=1.5)
import { readFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PX = Number(process.env.PX_PER_M ?? 40);
const MARGIN = Number(process.env.MARGIN ?? 1.5);
const TOP = Number(process.env.SURVEY_TOP ?? 23.5);
/** Kenar → düzlem ofseti (dış normal boyunca, m): "binaId:kenar=δ,..." veya tek sayı */
const DELTA = process.env.DELTA ?? '';
const OUT = process.env.SURVEY_OUT ?? '';
const ONLY_EDGE = process.env.EDGES ? new Set(process.env.EDGES.split(',').map(Number)) : null;
// KARAR (2026-09-29, docs/SV_CAMERA.md): Street View kamera yüksekliği (yol yüzeyinden) çekim dönemine göre ölçüldü —
// 2025-09 yeni kamera 2.35 ± 0.07 m, 2019-05 2.55 ± 0.10, 2014-07 2.80 ± 0.15 (eskiden hepsi 2.5 varsayılıyordu).
// Cephe ortofotosunda kamera yüksekliği yalnızca DÜŞEY KAYMA yapar (yatay konum ve düşey ölçek pano–düzlem
// mesafesinden gelir). sv-extra.json `base` değerleri 2.5 ile kenar başına görsel oturtuldu, yani bu kaymayı içerir
// (2025 panolarında +0.15 m): yeni yükseklikle üretilen ortofotoda içerik pencerede 0.15 m aşağı iner, kırmızı zemin
// çizgisi cephe dibinin 0.15 m üstünde kalır → yeniden oturtururken base −(2.5 − H). Survey ölçüleri bu çizgiye
// göreli olduğundan derlenmiş cepheler değişmez. Eski ortofotoların aynısı için SV_CAM_H=2.5.
const CAM_H_BY_DATE = { '2025-09': 2.35, '2019-05': 2.55, '2014-07': 2.8 };
// KARAR (ana oturum): varsayılan 2.5 KALIR — tüm survey u/y ölçüleri ve `base` değerleri 2.5'li ortofotolara göre;
// ortofotoyu yeniden üreten bir ajan yeni yükseklikle üretirse aynı dosyadaki eski/yeni ölçüler 0.15 m kayardı.
// Fiziksel olarak doğru ortofoto için SV_CAM_DATE=1 (o zaman base −(2.5 − H) ile yeniden oturtulur) ya da SV_CAM_H.
const camH = (date) =>
  Number(process.env.SV_CAM_H ?? (process.env.SV_CAM_DATE ? CAM_H_BY_DATE[date] : undefined) ?? 2.5);
const S = 640;
const ONLY = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const outDir = join(root, 'docs', 'survey', OUT);
function deltaOf(b, e) {
  if (!DELTA) return 0;
  if (!DELTA.includes('=')) return Number(DELTA);
  for (const kv of DELTA.split(',')) {
    const [k, v] = kv.split('=');
    if (k === `${b}:${e}`) return Number(v);
  }
  return 0;
}

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

function camOf(x, y, z, hDeg, pDeg, fov) {
  const h = (hDeg * Math.PI) / 180;
  const p = (pDeg * Math.PI) / 180;
  const f = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const focal = S / 2 / Math.tan((fov * Math.PI) / 360);
  return { c: [x, y, z], f, r, u, focal };
}

function project(cam, P) {
  const d = [P[0] - cam.c[0], P[1] - cam.c[1], P[2] - cam.c[2]];
  const zc = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
  if (zc < 0.3) return null;
  const x = S / 2 + (cam.focal * (d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2])) / zc;
  const y = S / 2 - (cam.focal * (d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2])) / zc;
  return [x, y];
}

async function main() {
  const cfg = JSON.parse(await readFile(join(root, 'scripts', 'sv-extra.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const pos = new Map(idx.panos.map((p) => [p.id, p]));
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  await mkdir(outDir, { recursive: true });
  const cache = new Map();
  const img = async (file) => {
    if (!cache.has(file)) {
      const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      cache.set(file, data);
    }
    return cache.get(file);
  };
  // Düzeltilmiş taban izleri (sv-footprint-fit.mjs): CORRECTED=1 → kenar uçları düzeltilmiş halkadan
  let fp = null;
  if (process.env.CORRECTED) {
    fp = JSON.parse(
      await readFile(join(root, 'src', 'worlds', 'mertkent', 'data', 'footprints.json'), 'utf8'),
    );
  }
  let made = 0;
  for (const s0 of cfg.survey ?? []) {
    let s = s0;
    if (fp) {
      // Kilitli girdi: taban izine köşe eklendi ve survey kenarları yeniden numaralandı (ör. 1480163634 FP-v3);
      // eski ortofotolar u koordinatlarının referansı olarak kalır, yeni halkayla yeniden üretilmez.
      if (s0.lock) {
        console.warn(`• ${s0.building} kenar ${s0.edge}: kilitli (lock) — düzeltilmiş halkayla üretilmedi`);
        continue;
      }
      const f = fp[s0.building];
      if (!f) continue;
      const R = f.ring;
      s = { ...s0, a: R[s0.edge], e: R[(s0.edge + 1) % R.length] };
    }
    if (ONLY && !ONLY.has(s.building)) continue;
    if (ONLY_EDGE && !ONLY_EDGE.has(s.edge)) continue;
    const dl = deltaOf(s.building, s.edge);
    const p = pos.get(s.pano);
    if (!p) continue;
    const cy = H(p.x, p.z) + camH(p.date);
    // Yakın plan (dar görüş açılı) karolar: `s.fov` (ör. 22°) → daha yüksek çözünürlüklü ortofoto (`_f22` son eki)
    const fov = s.fov ?? 40;
    const px = fov < 40 ? Math.min(120, (PX * 40) / fov) : PX;
    const tiles = [];
    for (const t of s.tiles) {
      const file = join(root, 'streetview-src', 'extra', `${s.pano}_${t.h}_${t.p}_${fov}.jpg`);
      if (!(await exists(file))) continue;
      tiles.push({ cam: camOf(p.x, cy, p.z, t.h, t.p, fov), data: await img(file) });
    }
    if (!tiles.length) continue;
    const len = Math.hypot(s.e[0] - s.a[0], s.e[1] - s.a[1]);
    const tx = (s.e[0] - s.a[0]) / len;
    const tz = (s.e[1] - s.a[1]) / len;
    // Düzlemi dış normal (−tz, tx) boyunca δ kaydır
    const ax = s.a[0] - tz * dl;
    const az = s.a[1] + tx * dl;
    const W = Math.round((len + MARGIN * 2) * px);
    const Hh = Math.round((TOP + 1) * px);
    const out = Buffer.alloc(W * Hh * 3, 0);
    for (let j = 0; j < Hh; j++) {
      const y = s.base - 0.5 + (Hh - 1 - j) / px;
      for (let i = 0; i < W; i++) {
        const u = i / px - MARGIN;
        const P = [ax + tx * u, y, az + tz * u];
        let best = -1;
        let bx = 0;
        let by = 0;
        let bt = null;
        for (const t of tiles) {
          const q = project(t.cam, P);
          if (!q || q[0] < 1 || q[1] < 1 || q[0] > S - 2 || q[1] > S - 2) continue;
          const w = 1 - Math.max(Math.abs(q[0] - S / 2), Math.abs(q[1] - S / 2)) / (S / 2);
          if (w > best) {
            best = w;
            bx = q[0];
            by = q[1];
            bt = t;
          }
        }
        if (!bt) continue;
        // Çift doğrusal örnekleme
        const x0 = Math.floor(bx);
        const y0 = Math.floor(by);
        const fx = bx - x0;
        const fy = by - y0;
        const o = (j * W + i) * 3;
        for (let c = 0; c < 3; c++) {
          const a00 = bt.data[(y0 * S + x0) * 3 + c];
          const a10 = bt.data[(y0 * S + x0 + 1) * 3 + c];
          const a01 = bt.data[((y0 + 1) * S + x0) * 3 + c];
          const a11 = bt.data[((y0 + 1) * S + x0 + 1) * 3 + c];
          out[o + c] = Math.round(
            a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) + a01 * (1 - fx) * fy + a11 * fx * fy,
          );
        }
      }
    }
    const name = `${s.building}_${s.edge}_${s.pano.slice(0, 8)}${fov !== 40 ? `_f${fov}` : ''}`;
    const base = sharp(out, { raw: { width: W, height: Hh, channels: 3 } });
    await base
      .clone()
      .jpeg({ quality: 90 })
      .toFile(join(outDir, `${name}.jpg`));
    // Izgara: 1 m ince, 5 m kalın + etiket; zemin (base) çizgisi kırmızı; kenar uçları sarı
    let svg = `<svg width="${W}" height="${Hh}" xmlns="http://www.w3.org/2000/svg">`;
    for (let m = Math.ceil(-MARGIN); m <= len + MARGIN; m++) {
      const x = (m + MARGIN) * px;
      const major = m % 5 === 0;
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${Hh}" stroke="${major ? '#00ffff' : '#ffffff'}" stroke-opacity="${major ? 0.7 : 0.3}" stroke-width="${major ? 2 : 1}"/>`;
      if (major)
        svg += `<text x="${x + 3}" y="${Hh - 6}" font-size="16" fill="#00ffff" font-family="sans-serif">${m}m</text>`;
    }
    for (let m = 0; m <= TOP; m++) {
      const yv = Hh - 1 - (m + 0.5) * px;
      const major = m % 3 === 0;
      svg += `<line x1="0" y1="${yv}" x2="${W}" y2="${yv}" stroke="${m === 0 ? '#ff3030' : major ? '#00ffff' : '#ffffff'}" stroke-opacity="${m === 0 ? 0.9 : major ? 0.6 : 0.25}" stroke-width="${m === 0 || major ? 2 : 1}"/>`;
      if (major)
        svg += `<text x="4" y="${yv - 4}" font-size="16" fill="#00ffff" font-family="sans-serif">${m}m</text>`;
    }
    for (const xm of [MARGIN, len + MARGIN])
      svg += `<line x1="${xm * px}" y1="0" x2="${xm * px}" y2="${Hh}" stroke="#ffe000" stroke-width="3" stroke-dasharray="12 8"/>`;
    svg += `<text x="10" y="24" font-size="20" fill="#ffe000" font-family="sans-serif">${name} len=${len.toFixed(2)}m dist=${s.dist}m δ=${dl}</text></svg>`;
    await base
      .clone()
      .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
      .jpeg({ quality: 85 })
      .toFile(join(outDir, `${name}_grid.jpg`));
    made++;
    if (cache.size > 60) cache.clear();
  }
  console.log(`✓ ${made} ortofoto → docs/survey/`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

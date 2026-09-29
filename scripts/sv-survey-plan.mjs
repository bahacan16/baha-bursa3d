#!/usr/bin/env node
// Cephe ölçümü için yüksek çözünürlüklü kare planı: her hedef bina kenarını (cephe) en iyi gören 2 panoramadan,
// cepheyi tamamen kaplayan 40°'lik karo ızgarası ister (aynı merkezden → birleştirme parallaks'sız).
// Çıktı: scripts/sv-extra.json içine { survey: [...] } + requests (mevcut isteklerin sonuna, tekrarsız).
// Kullanım: node scripts/sv-survey-plan.mjs [osmId,...]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';
import { Occluders, ring } from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_IDS = [1480041342, 1480041343, 1480041344, 1480041345, 1540901795, 1540901796];
const IDS = (process.argv[2] ?? DEFAULT_IDS.join(',')).split(',').map(Number);
const FOV = 40;
const STEP = 30; // karo aralığı (derece), %25 bindirme
const CAM_H = 2.5;
const TOP = Number(process.env.SURVEY_TOP ?? 23.5); // zeminden cephe üstü (çatı dahil)
/** Pano–cephe en uzak mesafe (arka cepheler karşı caddeden: SURVEY_MAXD=90) */
const MAXD = Number(process.env.SURVEY_MAXD ?? 45);

const deg = (r) => (r * 180) / Math.PI;

async function main() {
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  // 2020 öncesi kareler yalnız SURVEY_ALLOW_OLD=1 ile ve düşük puanla (yeni kare yoksa; ör. Doğan Avcıoğlu doğusu 2019-05)
  const ALLOW_OLD = process.env.SURVEY_ALLOW_OLD === '1';
  const panos = idx.panos.filter((p) => ALLOW_OLD || !p.date || p.date >= '2020');
  const ageF = (p) => (!p.date || p.date >= '2020' ? 1 : 0.45);
  const buildings = osm.ways
    .filter((w) => w.t && w.t.building && w.p.length >= 6)
    .map((w) => ({ id: w.i, ring: ring(w.p) }));
  // OSM'de olmayan, hava fotoğrafı + Street View'dan çizilmiş binalar (footprints.json `synthetic: true`)
  const fpAll = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'mertkent', 'data', 'footprints.json'), 'utf8'),
  );
  for (const [k, f] of Object.entries(fpAll))
    if (f.synthetic && f.ring?.length >= 3 && !buildings.some((b) => b.id === Number(k)))
      buildings.push({ id: Number(k), ring: f.ring.flat() });
  const occ = new Occluders(buildings);
  const cfgPath = join(root, 'scripts', 'sv-extra.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  const have = new Set(cfg.requests.map((r) => `${r.pano}_${r.h}_${r.p}_${r.fov}`));
  const survey = [];
  let added = 0;
  for (const id of IDS) {
    const b = buildings.find((x) => x.id === id);
    if (!b) continue;
    let r = b.ring;
    // Dış normal (−dz, dx) olacak yön
    let a2 = 0;
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a2 += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
    }
    if (a2 > 0) {
      const rr = [];
      for (let i = n - 1; i >= 0; i--) rr.push(r[2 * i], r[2 * i + 1]);
      r = rr;
    }
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, H(r[2 * i], r[2 * i + 1]));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[2 * i];
      const az = r[2 * i + 1];
      const ex = r[2 * j];
      const ez = r[2 * j + 1];
      const len = Math.hypot(ex - ax, ez - az);
      if (len < 2.5) continue;
      const tx = (ex - ax) / len;
      const tz = (ez - az) / len;
      const nx = -tz;
      const nz = tx;
      const mx = (ax + ex) / 2;
      const mz = (az + ez) / 2;
      const cands = [];
      for (const p of panos) {
        const vx = p.x - mx;
        const vz = p.z - mz;
        const d = Math.hypot(vx, vz);
        const front = (vx * nx + vz * nz) / d;
        if (d < 3 || d > MAXD || front < 0.3) continue;
        // Kenarın 3 noktasından en az 2'si görünür olsun
        let vis = 0;
        for (const f of [0.1, 0.5, 0.9]) {
          const qx = ax + (ex - ax) * f + nx * 0.3;
          const qz = az + (ez - az) * f + nz * 0.3;
          if (!occ.blocked(p.x, p.z, qx, qz, [id, i])) vis++;
        }
        if (vis < 2) continue;
        // Çözünürlük: yakın iyi ama çok yakında cephe ~180° kaplar; 8–25 m ideal
        const res = d < 8 ? d / 8 : d > 25 ? 25 / d : 1; // uzak panolar düşük puan (yalnız başka yoksa seçilir)
        cands.push({ p, d, score: front * res * (vis / 3) * ageF(p) });
      }
      cands.sort((u, v) => v.score - u.score);
      const pick = [];
      for (const c of cands) {
        if (pick.some((q) => Math.hypot(q.p.x - c.p.x, q.p.z - c.p.z) < 6)) continue;
        pick.push(c);
        if (pick.length === (ALLOW_OLD ? 3 : 2)) break;
      }
      for (const c of pick) {
        const p = c.p;
        const cy = H(p.x, p.z) + CAM_H;
        // Cephe dikdörtgeninin açısal kapsamı (kenar ±0.5 m, zemin−0.5 … üst)
        const pts = [];
        for (const f of [-0.02, 0.25, 0.5, 0.75, 1.02])
          for (const y of [base - 0.5, base + TOP * 0.5, base + TOP]) {
            const x = ax + (ex - ax) * f;
            const z = az + (ez - az) * f;
            const dx = x - p.x;
            const dz = z - p.z;
            const h = Math.atan2(dx, -dz);
            const pt = Math.atan2(y - cy, Math.hypot(dx, dz));
            pts.push([h, pt]);
          }
        // Yön açılarını pano→cephe orta yönü etrafında aç
        const hc = Math.atan2(mx - p.x, -(mz - p.z));
        const hs = pts.map(([h]) => {
          let d = h - hc;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          return d;
        });
        const h0 = deg(Math.min(...hs)) - 6;
        const h1 = deg(Math.max(...hs)) + 6;
        const p0 = Math.max(-40, deg(Math.min(...pts.map((q) => q[1]))) - 4);
        const p1 = Math.min(80, deg(Math.max(...pts.map((q) => q[1]))) + 4);
        const tiles = [];
        const nh = Math.max(1, Math.ceil((h1 - h0 - FOV) / STEP) + 1);
        const np = Math.max(1, Math.ceil((p1 - p0 - FOV) / STEP) + 1);
        for (let a = 0; a < nh; a++)
          for (let bb = 0; bb < np; bb++) {
            const hh = h0 + FOV / 2 + (nh === 1 ? (h1 - h0 - FOV) / 2 : ((h1 - h0 - FOV) * a) / (nh - 1));
            const pp = p0 + FOV / 2 + (np === 1 ? (p1 - p0 - FOV) / 2 : ((p1 - p0 - FOV) * bb) / (np - 1));
            const H2 = Math.round((((deg(hc) + hh) % 360) + 360) % 360);
            const P2 = Math.round(Math.max(-60, Math.min(85, pp)));
            tiles.push({ h: H2, p: P2 });
          }
        survey.push({
          building: id,
          edge: i,
          a: [+ax.toFixed(2), +az.toFixed(2)],
          e: [+ex.toFixed(2), +ez.toFixed(2)],
          base: +base.toFixed(2),
          pano: p.id,
          date: p.date ?? null,
          dist: +c.d.toFixed(1),
          tiles,
        });
        for (const t of tiles) {
          const k = `${p.id}_${t.h}_${t.p}_${FOV}`;
          if (have.has(k)) continue;
          have.add(k);
          cfg.requests.push({ pano: p.id, h: t.h, p: t.p, fov: FOV });
          added++;
        }
      }
    }
  }
  // Çevre ayrıntıları: site sınırına 22 m içindeki panolardan çite/kaldırıma yakın plan (malzeme ve ölçü için)
  if (process.env.SURVEY_PERIMETER) {
    const rings = [1456487000, 1546816188]
      .map((id) => osm.ways.find((w) => w.i === id))
      .filter(Boolean)
      .map((w) => w.p);
    const nearest = (x, z) => {
      let best = null;
      for (const rp of rings)
        for (let i = 0; i + 3 < rp.length; i += 2) {
          const ax = rp[i];
          const az = rp[i + 1];
          const dx = rp[i + 2] - ax;
          const dz = rp[i + 3] - az;
          const L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const qx = ax + dx * t;
          const qz = az + dz * t;
          const d = Math.hypot(x - qx, z - qz);
          if (!best || d < best.d) best = { d, qx, qz };
        }
      return best;
    };
    let pc = 0;
    for (const p of panos) {
      const nb = nearest(p.x, p.z);
      if (!nb || nb.d > 22) continue;
      const h = Math.round(((deg(Math.atan2(nb.qx - p.x, -(nb.qz - p.z))) % 360) + 360) % 360);
      for (const [dh, pp] of [
        [0, -5],
        [0, -38],
        [-40, -15],
        [40, -15],
      ]) {
        const hh = (h + dh + 360) % 360;
        const k = `${p.id}_${hh}_${pp}_${FOV}`;
        if (have.has(k)) continue;
        have.add(k);
        cfg.requests.push({ pano: p.id, h: hh, p: pp, fov: FOV });
        added++;
        pc++;
      }
    }
    console.log(`çevre ayrıntı: ${pc} karo`);
  }
  cfg.survey = [...(cfg.survey ?? []).filter((s) => !IDS.includes(s.building)), ...survey];
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${survey.length} cephe-görüş, ${added} yeni karo (toplam istek ${cfg.requests.length})`);
  const byB = {};
  for (const s of survey) byB[s.building] = (byB[s.building] ?? 0) + s.tiles.length;
  console.log(byB);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

#!/usr/bin/env node
// El modeli binalarının gerçek konumu: OSM taban izini (şekil/yön korunarak) ±R m öteleyip, farklı panoramalardan
// gelen karelerin üst katlarda (çit/ağaç üstü) en tutarlı (NCC) olduğu ötelemeyi bulur.
// Çıktı: public/streetview/sv-main/align.json { [osmId]: { dx, dz, score, base } }
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';
import { Occluders, outwardNormal, ring } from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDS = (
  process.env.SV_IDS ?? '1480041342,1480041343,1480041344,1480041345,1540901795,1540901796,1546816259'
)
  .split(',')
  .map(Number);
const R = Number(process.env.SV_R ?? 9);
const STEP = Number(process.env.SV_STEP ?? 0.5);
const S = 640;

function ncc(a, b) {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  if (n < 25) return null;
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    const x = a[i] - ma;
    const y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa < 1e-6 || bb < 1e-6) return null;
  return ab / Math.sqrt(aa * bb);
}

async function main() {
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  const main = JSON.parse(await readFile(join(root, 'streetview-src', 'sv-main', 'index.json'), 'utf8'));
  const extra = JSON.parse(await readFile(join(root, 'streetview-src', 'extra', 'extra.json'), 'utf8'));
  const pos = new Map(main.panos.filter((p) => !p.date || p.date >= '2020').map((p) => [p.id, p]));
  // Kameralar: ana kareler (fov 90) + ek kareler (fov değişken)
  const cams = [];
  const add = (p, v, dir) => {
    const h = (v.h * Math.PI) / 180;
    const pt = (v.p * Math.PI) / 180;
    const f = [Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)];
    const r = [Math.cos(h), 0, Math.sin(h)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const focal = S / 2 / Math.tan(((v.fov ?? 90) * Math.PI) / 360);
    cams.push({ pano: p.id, file: join(dir, v.file), c: [p.x, H(p.x, p.z) + 2.5, p.z], f, r, u, focal });
  };
  for (const p of pos.values())
    for (const v of p.views) if (!v.ground) add(p, v, join(root, 'streetview-src', 'sv-main'));
  for (const fr of extra.frames) {
    const p = pos.get(fr.pano);
    if (p) add(p, fr, join(root, 'streetview-src', 'extra'));
  }
  const gray = new Map();
  const img = async (c) => {
    if (!gray.has(c.file))
      gray.set(
        c.file,
        await sharp(c.file)
          .greyscale()
          .blur(1.5)
          .raw()
          .toBuffer()
          .then((b) => new Uint8Array(b)),
      );
    return gray.get(c.file);
  };
  const buildings = osm.ways
    .filter((w) => w.t && w.t.building && w.p.length >= 6)
    .map((w) => ({ id: w.i, ring: ring(w.p), t: w.t }));
  const out = {};
  for (const id of IDS) {
    const b = buildings.find((x) => x.id === id);
    if (!b) continue;
    const others = new Occluders(buildings.filter((x) => x.id !== id));
    const r = b.ring;
    const n = r.length / 2;
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, H(r[2 * i], r[2 * i + 1]));
    const top = id === 1546816259 ? base + 4.3 : base + 21;
    const yLo = id === 1546816259 ? base + 2.4 : base + 8; // çit/ağaç üstü
    // Duvar örnekleri (öteleme sıfırken tanımlı, ötelemeyle birlikte kayar)
    const walls = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[2 * i];
      const az = r[2 * i + 1];
      const ex = r[2 * j];
      const ez = r[2 * j + 1];
      const len = Math.hypot(ex - ax, ez - az);
      if (len < 2) continue;
      const [nx, nz] = outwardNormal(r, i);
      walls.push({ ax, az, ex, ez, len, nx, nz });
    }
    // Aday kameralar: binanın 60 m içinde
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += r[2 * i];
      cz += r[2 * i + 1];
    }
    cx /= n;
    cz /= n;
    const near = cams.filter((c) => Math.hypot(c.c[0] - cx, c.c[2] - cz) < 60);
    for (const c of near) c.g = await img(c);
    let best = { score: -Infinity, dx: 0, dz: 0 };
    const grid = [];
    for (let dx = -R; dx <= R + 1e-6; dx += STEP)
      for (let dz = -R; dz <= R + 1e-6; dz += STEP) {
        let sum = 0;
        let cnt = 0;
        for (const w of walls) {
          const NU = Math.max(4, Math.min(12, Math.round(w.len / 1.5)));
          const NV = 8;
          // Bu duvarı dışarıdan, engelsiz gören kameralar (öteleme ile)
          const mx = (w.ax + w.ex) / 2 + dx;
          const mz = (w.az + w.ez) / 2 + dz;
          const vis = near.filter((c) => {
            const vx = c.c[0] - mx;
            const vz = c.c[2] - mz;
            const d = Math.hypot(vx, vz);
            return (
              d > 3 &&
              d < 55 &&
              (vx * w.nx + vz * w.nz) / d > 0.3 &&
              !others.blocked(c.c[0], c.c[2], mx, mz, null)
            );
          });
          if (new Set(vis.map((c) => c.pano)).size < 2) continue;
          const vecs = vis.map(() => new Float32Array(NU * NV).fill(NaN));
          let k = 0;
          for (let iu = 0; iu < NU; iu++) {
            const t = 0.1 + (0.8 * (iu + 0.5)) / NU;
            const x = w.ax + (w.ex - w.ax) * t + dx + w.nx * 0.05;
            const z = w.az + (w.ez - w.az) * t + dz + w.nz * 0.05;
            for (let iv = 0; iv < NV; iv++, k++) {
              const y = yLo + ((top - yLo) * (iv + 0.5)) / NV;
              for (let ci = 0; ci < vis.length; ci++) {
                const c = vis[ci];
                const px = x - c.c[0];
                const py = y - c.c[1];
                const pz = z - c.c[2];
                const zc = px * c.f[0] + py * c.f[1] + pz * c.f[2];
                if (zc < 0.5) continue;
                const u = S / 2 + (c.focal * (px * c.r[0] + py * c.r[1] + pz * c.r[2])) / zc;
                const v = S / 2 - (c.focal * (px * c.u[0] + py * c.u[1] + pz * c.u[2])) / zc;
                if (u < 2 || v < 2 || u > S - 3 || v > S - 3) continue;
                const iu2 = Math.floor(u);
                const iv2 = Math.floor(v);
                vecs[ci][k] = c.g[iv2 * S + iu2];
              }
            }
          }
          for (let a = 0; a < vis.length; a++)
            for (let c = a + 1; c < vis.length; c++) {
              if (vis[a].pano === vis[c].pano) continue;
              const s = ncc(vecs[a], vecs[c]);
              if (s === null) continue;
              sum += s;
              cnt++;
            }
        }
        const score = cnt >= 6 ? sum / cnt : -Infinity;
        grid.push(score);
        if (score > best.score) best = { score, dx, dz };
      }
    const valid = grid.filter(Number.isFinite);
    const mean = valid.reduce((a, v) => a + v, 0) / (valid.length || 1);
    out[id] = {
      dx: best.dx,
      dz: best.dz,
      score: +best.score.toFixed(3),
      mean: +mean.toFixed(3),
      base: +base.toFixed(2),
    };
    console.log(id, out[id]);
    for (const c of near) c.g = null;
    gray.clear();
  }
  await writeFile(join(root, 'public', 'streetview', 'sv-main', 'align.json'), JSON.stringify(out, null, 1));
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

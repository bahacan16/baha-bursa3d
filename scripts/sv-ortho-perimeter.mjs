#!/usr/bin/env node
// Çevre ölçümü: site sınırına yakın her panoramanın yakın plan karelerinden (40°) iki dik görüntü üretir:
//  1) çit cephesi (en yakın sınır kenarı düzlemi, ±12 m, −0.5…3.5 m)  → <pano8>_fence(_grid).jpg
//  2) yer planı (çit hattından panoramaya kadar şerit, ±10 m)           → <pano8>_ground(_grid).jpg
// Çıktı: docs/survey/perim/ (repoda değil)
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = 640;
const CAM_H = 2.5;
const PX = Number(process.env.PX_PER_M ?? 60);
const outDir = join(root, 'docs', 'survey', 'perim');

function camOf(x, y, z, hDeg, pDeg, fov) {
  const h = (hDeg * Math.PI) / 180;
  const p = (pDeg * Math.PI) / 180;
  const f = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { c: [x, y, z], f, r, u, focal: S / 2 / Math.tan((fov * Math.PI) / 360) };
}
function project(cam, P) {
  const d = [P[0] - cam.c[0], P[1] - cam.c[1], P[2] - cam.c[2]];
  const zc = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
  if (zc < 0.3) return null;
  return [
    S / 2 + (cam.focal * (d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2])) / zc,
    S / 2 - (cam.focal * (d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2])) / zc,
  ];
}

async function render(tiles, W, Hh, point) {
  const out = Buffer.alloc(W * Hh * 3, 0);
  for (let j = 0; j < Hh; j++)
    for (let i = 0; i < W; i++) {
      const P = point(i, j);
      let best = -1;
      let bq = null;
      let bt = null;
      for (const t of tiles) {
        const q = project(t.cam, P);
        if (!q || q[0] < 1 || q[1] < 1 || q[0] > S - 2 || q[1] > S - 2) continue;
        const w = 1 - Math.max(Math.abs(q[0] - S / 2), Math.abs(q[1] - S / 2)) / (S / 2);
        if (w > best) {
          best = w;
          bq = q;
          bt = t;
        }
      }
      if (!bt) continue;
      const x0 = Math.floor(bq[0]);
      const y0 = Math.floor(bq[1]);
      const fx = bq[0] - x0;
      const fy = bq[1] - y0;
      const o = (j * W + i) * 3;
      for (let c = 0; c < 3; c++) {
        const a = bt.data;
        out[o + c] = Math.round(
          a[(y0 * S + x0) * 3 + c] * (1 - fx) * (1 - fy) +
            a[(y0 * S + x0 + 1) * 3 + c] * fx * (1 - fy) +
            a[((y0 + 1) * S + x0) * 3 + c] * (1 - fx) * fy +
            a[((y0 + 1) * S + x0 + 1) * 3 + c] * fx * fy,
        );
      }
    }
  return out;
}

function gridSvg(W, Hh, xs, ys, title) {
  let s = `<svg width="${W}" height="${Hh}" xmlns="http://www.w3.org/2000/svg">`;
  for (const [x, lab, major] of xs) {
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${Hh}" stroke="${major ? '#00ffff' : '#fff'}" stroke-opacity="${major ? 0.7 : 0.3}" stroke-width="${major ? 2 : 1}"/>`;
    if (major)
      s += `<text x="${x + 3}" y="${Hh - 6}" font-size="15" fill="#00ffff" font-family="sans-serif">${lab}</text>`;
  }
  for (const [y, lab, major] of ys) {
    s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#00ffff' : '#fff'}" stroke-opacity="${major ? 0.7 : 0.3}" stroke-width="${major ? 2 : 1}"/>`;
    if (major)
      s += `<text x="4" y="${y - 4}" font-size="15" fill="#00ffff" font-family="sans-serif">${lab}</text>`;
  }
  return (
    s + `<text x="8" y="22" font-size="18" fill="#ffe000" font-family="sans-serif">${title}</text></svg>`
  );
}

async function main() {
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  await mkdir(outDir, { recursive: true });
  const files = new Set(await readdir(join(root, 'streetview-src', 'extra')));
  const rings = [1456487000, 1546816188].map((id) => osm.ways.find((w) => w.i === id).p);
  let made = 0;
  for (const p of idx.panos) {
    if (p.date && p.date < '2020') continue;
    const tl = [...files].filter((f) => f.startsWith(`${p.id}_`) && f.endsWith('_40.jpg'));
    const near = tl.filter((f) => {
      const pp = Number(f.slice(p.id.length + 1).split('_')[1]);
      return pp <= -3 && pp >= -45;
    });
    if (near.length < 2) continue;
    // En yakın sınır kenarı
    let best = null;
    for (const rp of rings)
      for (let i = 0; i + 3 < rp.length; i += 2) {
        const ax = rp[i];
        const az = rp[i + 1];
        const dx = rp[i + 2] - ax;
        const dz = rp[i + 3] - az;
        const L = Math.hypot(dx, dz);
        const t = Math.max(0, Math.min(L, ((p.x - ax) * dx + (p.z - az) * dz) / L));
        const qx = ax + (dx / L) * t;
        const qz = az + (dz / L) * t;
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (!best || d < best.d) best = { d, qx, qz, tx: dx / L, tz: dz / L };
      }
    if (!best || best.d > 22) continue;
    // Normal panoramaya doğru
    let nx = -best.tz;
    let nz = best.tx;
    if ((p.x - best.qx) * nx + (p.z - best.qz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const cy = H(p.x, p.z) + CAM_H;
    const tiles = [];
    for (const f of tl) {
      const [hs, ps] = f.slice(p.id.length + 1).split('_');
      const { data } = await sharp(join(root, 'streetview-src', 'extra', f))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      tiles.push({ cam: camOf(p.x, cy, p.z, Number(hs), Number(ps), 40), data });
    }
    const name = p.id.slice(0, 8);
    const y0 = H(best.qx, best.qz);
    // 1) Çit cephesi: u ∈ [−12, 12] (kenar yönü), y ∈ [−0.5, 3.5]
    {
      const W = 24 * PX;
      const Hh = 4 * PX;
      const buf = await render(tiles, W, Hh, (i, j) => {
        const u = i / PX - 12;
        const y = y0 + 3.5 - j / PX;
        return [best.qx + best.tx * u, y, best.qz + best.tz * u];
      });
      const img = sharp(buf, { raw: { width: W, height: Hh, channels: 3 } });
      await img
        .clone()
        .jpeg({ quality: 90 })
        .toFile(join(outDir, `${name}_fence.jpg`));
      const xs = [];
      for (let m = -12; m <= 12; m++) xs.push([(m + 12) * PX, `${m}m`, m % 2 === 0]);
      const ys = [];
      for (let k = 0; k <= 8; k++) {
        const hm = 3.5 - k * 0.5;
        ys.push([k * 0.5 * PX, `${hm.toFixed(1)}m`, Math.abs(hm - Math.round(hm)) < 1e-6]);
      }
      await img
        .clone()
        .composite([
          {
            input: Buffer.from(
              gridSvg(W, Hh, xs, ys, `${name} çit (zemin=OSM kenar noktası y, pano ${best.d.toFixed(1)} m)`),
            ),
            left: 0,
            top: 0,
          },
        ])
        .jpeg({ quality: 85 })
        .toFile(join(outDir, `${name}_fence_grid.jpg`));
    }
    // 2) Yer planı: çit hattından (v=0) panoramaya doğru v ∈ [−1, d+2], u ∈ [−10, 10]
    {
      const D = Math.min(12, best.d + 2);
      const W = 20 * PX;
      const Hh = Math.round((D + 1) * PX);
      const buf = await render(tiles, W, Hh, (i, j) => {
        const u = i / PX - 10;
        const v = -1 + j / PX;
        const x = best.qx + best.tx * u + nx * v;
        const z = best.qz + best.tz * u + nz * v;
        return [x, H(x, z) + 0.12, z];
      });
      const img = sharp(buf, { raw: { width: W, height: Hh, channels: 3 } });
      await img
        .clone()
        .jpeg({ quality: 90 })
        .toFile(join(outDir, `${name}_ground.jpg`));
      const xs = [];
      for (let m = -10; m <= 10; m++) xs.push([(m + 10) * PX, `${m}m`, m % 2 === 0]);
      const ys = [];
      for (let m = -1; m <= D; m++) ys.push([(m + 1) * PX, `${m}m`, true]);
      await img
        .clone()
        .composite([
          {
            input: Buffer.from(gridSvg(W, Hh, xs, ys, `${name} yer (üst=çit hattı 0 m, aşağı=sokağa doğru)`)),
            left: 0,
            top: 0,
          },
        ])
        .jpeg({ quality: 85 })
        .toFile(join(outDir, `${name}_ground_grid.jpg`));
    }
    made++;
  }
  console.log(`✓ ${made} panorama için çit + yer dik görüntüsü → docs/survey/perim/`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

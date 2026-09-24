#!/usr/bin/env node
// Street View karelerini pilot binaların cephelerine yansıtıp tek bir doku atlasına "bake" eder.
// Ağ gerektirmez: public/streetview/<slug>/ altındaki indirilmiş kareleri kullanır.
// Çıktı: public/streetview/<slug>/facades.jpg + facades.json (duvar uçları, yükseklikler, atlas dikdörtgenleri)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';
import { Occluders, outwardNormal, pilotArea } from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = process.env.SV_SLUG || 'mertkent-2-etap';
const PPM = Number(process.env.SV_PPM ?? 16); // piksel / metre
const ATLAS_W = 4096;
const BURY = 0.6; // oyun duvarı eğimli arazide 0.6 m gömer
const SHARP = Number(process.env.SV_SHARP ?? 8); // en iyi kareye ağırlık keskinliği
const OFS = [Number(process.env.SV_DX ?? 0), Number(process.env.SV_DZ ?? 0)]; // kalibrasyon
const CAM_DH = Number(process.env.SV_DH ?? 0);
const HEAD_OFS = Number(process.env.SV_DHEAD ?? 0);

const svDir = join(root, 'public', 'streetview', SLUG);

async function main() {
  const index = JSON.parse(await readFile(join(svDir, 'index.json'), 'utf8'));
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const tbuf = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const terrain = parseTerrain(tbuf.buffer.slice(tbuf.byteOffset, tbuf.byteOffset + tbuf.byteLength));
  const H = (x, z) => sampleGrid(terrain.near, x, z);
  const { all, targets } = pilotArea(osm, index.area, 45);
  const occ = new Occluders(all);
  const S = index.size;
  const half = S / 2;
  const focal = half / Math.tan(((index.panos[0]?.views[0]?.fov ?? 90) * Math.PI) / 360);

  // Kameralar (her kare ayrı kamera)
  const cams = [];
  for (const p of index.panos) {
    const cx = p.x + OFS[0];
    const cz = p.z + OFS[1];
    const cy = H(cx, cz) + index.camHeight + CAM_DH;
    for (const v of p.views) {
      const h = ((v.h + HEAD_OFS) * Math.PI) / 180;
      const pt = (v.p * Math.PI) / 180;
      const f = [Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)];
      const r = [Math.cos(h), 0, Math.sin(h)];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      cams.push({ pano: p.id, file: v.file, c: [cx, cy, cz], f, r, u, img: null });
    }
  }
  console.log(`${index.panos.length} panorama, ${cams.length} kare, ${targets.length} bina`);

  const imgCache = new Map();
  async function img(cam) {
    if (imgCache.has(cam.file)) return imgCache.get(cam.file);
    const { data } = await sharp(join(svDir, cam.file))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (imgCache.size > 160) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(cam.file, data);
    return data;
  }

  // Duvarları topla ve raf (shelf) yerleşimi yap
  const walls = [];
  for (const b of targets) {
    const r = b.ring;
    const n = r.length / 2;
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, H(r[2 * i], r[2 * i + 1]));
    const y0 = base - BURY;
    const y1 = base + b.height;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [r[2 * i], r[2 * i + 1]];
      const e = [r[2 * j], r[2 * j + 1]];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 0.3) continue;
      walls.push({ b, i, a, e, len, y0, y1, n: outwardNormal(r, i), w: Math.max(2, Math.ceil(len * PPM)) });
    }
  }
  const rowH = Math.ceil((Math.max(...walls.map((w) => w.y1 - w.y0)) + 0.01) * PPM);
  let x = 0;
  let y = 0;
  for (const w of walls) {
    w.h = Math.ceil((w.y1 - w.y0) * PPM);
    if (w.w > ATLAS_W) w.w = ATLAS_W; // çok uzun duvar: yatayda sıkıştır
    if (x + w.w > ATLAS_W) {
      x = 0;
      y += rowH + 2;
    }
    w.rect = [x, y, w.w, w.h];
    x += w.w + 2;
  }
  const atlasH = Math.pow(2, Math.ceil(Math.log2(y + rowH + 2)));
  console.log(`${walls.length} duvar → atlas ${ATLAS_W}×${atlasH}`);
  const out = new Float32Array(ATLAS_W * atlasH * 3);
  const cov = new Float32Array(ATLAS_W * atlasH);

  let covered = 0;
  let total = 0;
  for (const w of walls) {
    const [nx, nz] = w.n;
    // Bu duvarı dışarıdan gören kameralar
    const mx = (w.a[0] + w.e[0]) / 2;
    const mz = (w.a[1] + w.e[1]) / 2;
    const cand = cams.filter((c) => {
      const dx = c.c[0] - mx;
      const dz = c.c[2] - mz;
      return dx * nx + dz * nz > 0.5 && Math.hypot(dx, dz) < 70;
    });
    for (const c of cand) c.img = await img(c);
    const [rx, ry, rw, rh] = w.rect;
    for (let px = 0; px < rw; px++) {
      const t = (px + 0.5) / rw;
      const wx = w.a[0] + (w.e[0] - w.a[0]) * t + nx * 0.02;
      const wz = w.a[1] + (w.e[1] - w.a[1]) * t + nz * 0.02;
      // Sütun başına görünürlük (2D, diğer binalar)
      const vis = [];
      for (const c of cand) {
        const dx = c.c[0] - wx;
        const dz = c.c[2] - wz;
        const d = Math.hypot(dx, dz);
        const cosA = (dx * nx + dz * nz) / d;
        if (cosA < 0.15) continue;
        if (occ.blocked(c.c[0], c.c[2], wx, wz, [w.b.id, w.i])) continue;
        vis.push({ c, d, cosA });
      }
      for (let py = 0; py < rh; py++) {
        const wy = w.y1 - ((py + 0.5) / rh) * (w.y1 - w.y0);
        total++;
        let sw = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (const { c, cosA } of vis) {
          const dx = wx - c.c[0];
          const dy = wy - c.c[1];
          const dz = wz - c.c[2];
          const zc = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
          if (zc <= 0.1) continue;
          const u = half + (focal * (dx * c.r[0] + dy * c.r[1] + dz * c.r[2])) / zc;
          const v = half - (focal * (dx * c.u[0] + dy * c.u[1] + dz * c.u[2])) / zc;
          if (u < 1 || v < 1 || u > S - 2 || v > S - 2) continue;
          // Ağırlık: dik bakış, yakınlık, görüntü merkezine yakınlık; alt kenar (araç/kaput) cezası
          const edge = Math.min(u, v, S - u, S - v) / half;
          const dist3 = Math.hypot(dx, dy, dz);
          let wgt = Math.pow(cosA, 1.5) * Math.min(1, edge * 3) * (1 / (1 + dist3 / 12));
          if (v > S * 0.9) wgt *= 0.2;
          if (wgt <= 0) continue;
          wgt = Math.pow(wgt, SHARP);
          const im = c.img;
          // Çift doğrusal örnekleme
          const iu = Math.floor(u);
          const iv = Math.floor(v);
          const fu = u - iu;
          const fv = v - iv;
          const o00 = (iv * S + iu) * 3;
          const o10 = o00 + 3;
          const o01 = o00 + S * 3;
          const o11 = o01 + 3;
          for (let k = 0; k < 3; k++) {
            const val =
              im[o00 + k] * (1 - fu) * (1 - fv) +
              im[o10 + k] * fu * (1 - fv) +
              im[o01 + k] * (1 - fu) * fv +
              im[o11 + k] * fu * fv;
            if (k === 0) sr += val * wgt;
            else if (k === 1) sg += val * wgt;
            else sb += val * wgt;
          }
          sw += wgt;
        }
        const o = (ry + py) * ATLAS_W + rx + px;
        if (sw > 0) {
          out[o * 3] = sr / sw;
          out[o * 3 + 1] = sg / sw;
          out[o * 3 + 2] = sb / sw;
          cov[o] = 1;
          covered++;
        }
      }
    }
    for (const c of cand) c.img = null;
  }
  console.log(`kaplanan texel: %${((covered / total) * 100).toFixed(1)}`);

  // Kaplanmayan texelleri duvar içinde doldur (satır/sütun yayma + bina ortalaması)
  for (const w of walls) {
    const [rx, ry, rw, rh] = w.rect;
    let c = 0;
    const mean = [0, 0, 0];
    for (let py = 0; py < rh; py++)
      for (let px = 0; px < rw; px++) {
        const o = (ry + py) * ATLAS_W + rx + px;
        if (cov[o]) {
          c++;
          for (let k = 0; k < 3; k++) mean[k] += out[o * 3 + k];
        }
      }
    w.cover = +(c / (rw * rh)).toFixed(3);
    w.mean = c ? mean.map((v) => v / c) : null;
  }
  const bMean = new Map();
  for (const w of walls) {
    if (!w.mean) continue;
    const m = bMean.get(w.b.id) ?? [0, 0, 0, 0];
    const k = w.cover * w.len;
    for (let i = 0; i < 3; i++) m[i] += w.mean[i] * k;
    m[3] += k;
    bMean.set(w.b.id, m);
  }
  for (const w of walls) {
    const [rx, ry, rw, rh] = w.rect;
    const bm = bMean.get(w.b.id);
    const fill = w.mean ?? (bm ? [bm[0] / bm[3], bm[1] / bm[3], bm[2] / bm[3]] : [200, 195, 185]);
    // Sütun boyunca en yakın kaplı pikselden yay; hiç yoksa dolgu rengi
    for (let px = 0; px < rw; px++) {
      let last = -1;
      for (let py = 0; py < rh; py++) {
        const o = (ry + py) * ATLAS_W + rx + px;
        if (cov[o]) last = o;
        else if (last >= 0)
          for (let k = 0; k < 3; k++) out[o * 3 + k] = out[last * 3 + k] * 0.6 + fill[k] * 0.4;
        else for (let k = 0; k < 3; k++) out[o * 3 + k] = fill[k];
      }
    }
  }

  const px = Buffer.alloc(ATLAS_W * atlasH * 3);
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(out[i])));
  await sharp(px, { raw: { width: ATLAS_W, height: atlasH, channels: 3 } })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(svDir, 'facades.jpg'));
  const json = {
    slug: SLUG,
    area: index.area,
    atlas: [ATLAS_W, atlasH],
    ppm: PPM,
    walls: walls.map((w) => ({
      b: w.b.id,
      a: w.a,
      e: w.e,
      y0: +w.y0.toFixed(3),
      y1: +w.y1.toFixed(3),
      rect: w.rect,
      cover: w.cover,
    })),
    attribution: index.attribution,
  };
  await writeFile(join(svDir, 'facades.json'), JSON.stringify(json));
  console.log(
    `✓ facades.jpg + facades.json (${walls.filter((w) => w.cover > 0.3).length}/${walls.length} duvar >%30 kaplı)`,
  );
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

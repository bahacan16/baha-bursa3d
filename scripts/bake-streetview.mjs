#!/usr/bin/env node
// Street View karelerinden pilot alanın gerçek fotoğraf dokularını "bake" eder (ağ gerektirmez).
// 1) Cepheler: her duvar tek panoramadan yansıtılır; kaplanmayan/uyumsuz duvarlar aynı binanın en temiz
//    fotoğraflı cephesinden döşenir ("tahmini" ama gerçek doku) → facades.jpg + facades.json
// 2) Site çitleri/çalılar: kaldırım dış kenarı boyunca şeritler; gökyüzü saydam → fences.png + fences.json
// 3) Zemin: yere düşen pikseller yerel ızgaraya ortofoto olarak → ground.jpg + ground-mask.png + ground.json
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';
import { FENCE_H, Occluders, centroid, inside, outwardNormal, pilotArea, siteFences } from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = process.env.SV_SLUG || 'mertkent-2-etap';
const BUFFER = Number(process.env.SV_BUFFER ?? 60);
const PPM = Number(process.env.SV_PPM ?? 16); // cephe piksel / metre
const ATLAS_W = 4096;
const BURY = 0.6; // oyun duvarı eğimli arazide 0.6 m gömer
const MAXD = Number(process.env.SV_MAXD ?? 35);
const GROUND_RES = Number(process.env.SV_GRES ?? 0.08); // m / piksel
const DEP_MIN = Number(process.env.SV_DEPMIN ?? 7); // yer pikseli: kameradan aşağı bakış açısı (derece)
const DEP_MAX = Number(process.env.SV_DEPMAX ?? 21); // üstü araç/bulanık nadir bölgesi
// KARAR: zemin ortofotosu varsayılan kapalı (araç/çalı lekeleri); SV_ONLY=ground ile denenebilir
const ONLY = process.env.SV_ONLY ?? 'facades,fences';

const svDir = join(root, 'streetview-src', SLUG); // ham kareler (sitede yayınlanmaz)
const outDir = join(root, 'public', 'streetview', SLUG); // bake çıktıları
const isSky = (R, G, B) => (B > 140 && B > R + 25 && B > G + 5) || (R > 238 && G > 238 && B > 238);

async function main() {
  await mkdir(outDir, { recursive: true });
  // Çalı/panel çit dokusu: temiz, yakın bir kareden kesit (3.8 m × 1.5 m)
  try {
    await sharp(join(svDir, 'qhqNP90CZmxzUp4jLL6-Jw_0_0.jpg'))
      .extract({ left: 0, top: 318, width: 420, height: 164 })
      .resize(512, 200)
      .jpeg({ quality: 90 })
      .toFile(join(outDir, 'hedge.jpg'));
  } catch {
    console.warn('⚠ çalı kesit karesi yok; mevcut hedge.jpg kullanılır');
  }
  const index = JSON.parse(await readFile(join(svDir, 'index.json'), 'utf8'));
  // KARAR: yalnızca güncel çekimler (eski panoramalarda binalar/boya farklı olabilir)
  index.panos = index.panos.filter((p) => !p.date || p.date >= '2020');
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const tbuf = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const terrain = parseTerrain(tbuf.buffer.slice(tbuf.byteOffset, tbuf.byteOffset + tbuf.byteLength));
  const H = (x, z) => sampleGrid(terrain.near, x, z);
  const { all, targets, bbox } = pilotArea(osm, index.area, BUFFER);
  const occ = new Occluders(all);
  const S = index.size;
  const half = S / 2;
  const focal = half / Math.tan((90 * Math.PI) / 360);

  // Kameralar: her kare ayrı kamera; aynı panoramanın kareleri aynı merkezi paylaşır
  const cams = [];
  const panoCams = new Map();
  for (const p of index.panos) {
    const cy = H(p.x, p.z) + index.camHeight;
    const list = [];
    for (const v of p.views) {
      const h = (v.h * Math.PI) / 180;
      const pt = (v.p * Math.PI) / 180;
      const f = [Math.sin(h) * Math.cos(pt), Math.sin(pt), -Math.cos(h) * Math.cos(pt)];
      const r = [Math.cos(h), 0, Math.sin(h)];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const cam = { pano: p.id, file: v.file, ground: !!v.ground, c: [p.x, cy, p.z], f, r, u };
      cams.push(cam);
      list.push(cam);
    }
    panoCams.set(p.id, list);
  }
  console.log(`${index.panos.length} panorama, ${cams.length} kare, ${targets.length} bina`);

  const imgCache = new Map();
  async function img(file) {
    if (imgCache.has(file)) return imgCache.get(file);
    const { data } = await sharp(join(svDir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(file, data);
    return data;
  }

  /** Noktayı kameraya yansıt → [u, v, zc] ya da null */
  function proj(c, x, y, z) {
    const dx = x - c.c[0];
    const dy = y - c.c[1];
    const dz = z - c.c[2];
    const zc = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
    if (zc <= 0.1) return null;
    const u = half + (focal * (dx * c.r[0] + dy * c.r[1] + dz * c.r[2])) / zc;
    const v = half - (focal * (dx * c.u[0] + dy * c.u[1] + dz * c.u[2])) / zc;
    if (u < 1 || v < 1 || u > S - 2 || v > S - 2) return null;
    return [u, v];
  }
  function rgb(im, u, v, out, o) {
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fu = u - iu;
    const fv = v - iv;
    const a = (iv * S + iu) * 3;
    const b = a + 3;
    const c = a + S * 3;
    const d = c + 3;
    for (let k = 0; k < 3; k++)
      out[o + k] =
        im[a + k] * (1 - fu) * (1 - fv) +
        im[b + k] * fu * (1 - fv) +
        im[c + k] * (1 - fu) * fv +
        im[d + k] * fu * fv;
  }

  /** Tek panoramadan dikey şerit (duvar/çit) bake eder. skip: occluder'da atlanacak kenar. */
  async function bakeStrip(w, atlas, W, cov, skip) {
    const [nx, nz] = w.n;
    const mx = (w.a[0] + w.e[0]) / 2;
    const mz = (w.a[1] + w.e[1]) / 2;
    let bestPano = null;
    let bestScore = 0;
    for (const [id, list] of panoCams) {
      const c0 = list[0];
      const dx = c0.c[0] - mx;
      const dz = c0.c[2] - mz;
      const d = Math.hypot(dx, dz);
      const cosA = (dx * nx + dz * nz) / d;
      if (d > w.maxd || cosA < 0.45) continue;
      let vis = 0;
      for (let k = 0; k < 9; k++) {
        const t = 0.1 + (0.8 * k) / 8;
        const wx = w.a[0] + (w.e[0] - w.a[0]) * t + nx * 0.05;
        const wz = w.a[1] + (w.e[1] - w.a[1]) * t + nz * 0.05;
        if (!occ.blocked(c0.c[0], c0.c[2], wx, wz, skip)) vis++;
      }
      const sc = cosA * cosA * (1 / (1 + d / 10)) * (vis / 9);
      if (sc > bestScore) {
        bestScore = sc;
        bestPano = id;
      }
    }
    w.pano = bestPano;
    w.viewScore = bestScore;
    if (!bestPano) return 0;
    const list = panoCams.get(bestPano);
    const ims = await Promise.all(list.map((c) => img(c.file)));
    const [rx, ry, rw, rh] = w.rect;
    const tmp = [0, 0, 0];
    let n = 0;
    for (let px = 0; px < rw; px++) {
      const t = (px + 0.5) / rw;
      const wx = w.a[0] + (w.e[0] - w.a[0]) * t + nx * 0.02;
      const wz = w.a[1] + (w.e[1] - w.a[1]) * t + nz * 0.02;
      if (occ.blocked(list[0].c[0], list[0].c[2], wx, wz, skip)) continue;
      for (let py = 0; py < rh; py++) {
        const wy = w.y1 - ((py + 0.5) / rh) * (w.y1 - w.y0);
        // Aynı merkezli kareler arasında görüntü merkezine en yakın olanı seç (dikişsiz)
        let best = -1;
        let bu = 0;
        let bv = 0;
        let be = -1;
        for (let k = 0; k < list.length; k++) {
          const p = proj(list[k], wx, wy, wz);
          if (!p) continue;
          const e = Math.min(p[0], p[1], S - p[0], S - p[1]);
          if (e > be) {
            be = e;
            best = k;
            bu = p[0];
            bv = p[1];
          }
        }
        if (best < 0) continue;
        rgb(ims[best], bu, bv, tmp, 0);
        const o = (ry + py) * W + rx + px;
        atlas[o * 3] = tmp[0];
        atlas[o * 3 + 1] = tmp[1];
        atlas[o * 3 + 2] = tmp[2];
        cov[o] = 1;
        n++;
      }
    }
    return n / (rw * rh);
  }

  /** Raf yerleşimi */
  function pack(items, rowH) {
    let x = 0;
    let y = 0;
    for (const w of items) {
      if (w.w > ATLAS_W) w.w = ATLAS_W;
      if (x + w.w > ATLAS_W) {
        x = 0;
        y += rowH + 2;
      }
      w.rect = [x, y, w.w, w.h];
      x += w.w + 2;
    }
    return Math.pow(2, Math.ceil(Math.log2(y + rowH + 2)));
  }

  /** Kaplanmamış şeridi bağışçı şeritten (yatay tekrar + ayna) doldurur. */
  function tileFrom(atlas, cov, W, w, d, alpha) {
    const [rx, ry, rw, rh] = w.rect;
    const [dx, dy, dw, dh] = d.rect;
    for (let px = 0; px < rw; px++) {
      const tile = Math.floor(px / dw);
      let sx = px % dw;
      if (tile % 2) sx = dw - 1 - sx;
      for (let py = 0; py < rh; py++) {
        const o = (ry + py) * W + rx + px;
        if (cov[o]) continue;
        const sy = Math.min(dh - 1, Math.floor(((py + 0.5) / rh) * dh));
        const so = (dy + sy) * W + dx + sx;
        for (let k = 0; k < 3; k++) atlas[o * 3 + k] = atlas[so * 3 + k];
        if (alpha) alpha[o] = alpha[so];
        cov[o] = 2;
      }
    }
  }

  function skyFrac(atlas, cov, W, w, rows = 1) {
    const [rx, ry, rw, rh] = w.rect;
    let s = 0;
    let c = 0;
    for (let py = 0; py < Math.floor(rh * rows); py++)
      for (let px = 0; px < rw; px++) {
        const o = (ry + py) * W + rx + px;
        if (cov[o] !== 1) continue;
        c++;
        if (isSky(atlas[o * 3], atlas[o * 3 + 1], atlas[o * 3 + 2])) s++;
      }
    return c ? s / c : 0;
  }

  async function writeRGB(atlas, W, Hh, file, q = 86) {
    const px = Buffer.alloc(W * Hh * 3);
    for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(atlas[i])));
    await sharp(px, { raw: { width: W, height: Hh, channels: 3 } })
      .jpeg({ quality: q, mozjpeg: true })
      .toFile(join(outDir, file));
  }

  // ───────────── 1) Cepheler ─────────────
  if (ONLY.includes('facades')) {
    const walls = [];
    for (const b of targets) {
      const r = b.ring;
      const n = r.length / 2;
      let base = Infinity;
      for (let i = 0; i < n; i++) base = Math.min(base, H(r[2 * i], r[2 * i + 1]));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = [r[2 * i], r[2 * i + 1]];
        const e = [r[2 * j], r[2 * j + 1]];
        const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
        if (len < 0.3) continue;
        walls.push({
          b,
          i,
          a,
          e,
          len,
          y0: base - BURY,
          y1: base + b.height,
          n: outwardNormal(r, i),
          w: Math.max(2, Math.ceil(len * PPM)),
          h: Math.ceil((b.height + BURY) * PPM),
          maxd: MAXD,
        });
      }
    }
    const rowH = Math.max(...walls.map((w) => w.h));
    const AH = pack(walls, rowH);
    console.log(`cephe: ${walls.length} duvar → ${ATLAS_W}×${AH}`);
    const atlas = new Float32Array(ATLAS_W * AH * 3);
    const cov = new Uint8Array(ATLAS_W * AH);
    for (const w of walls) {
      w.cover = await bakeStrip(w, atlas, ATLAS_W, cov, [w.b.id, w.i]);
      w.sky = skyFrac(atlas, cov, ATLAS_W, w);
      if (w.sky > 0.06 || w.cover < 0.5) {
        const [rx, ry, rw, rh] = w.rect;
        for (let py = 0; py < rh; py++) cov.fill(0, (ry + py) * ATLAS_W + rx, (ry + py) * ATLAS_W + rx + rw);
        w.photo = false;
      } else w.photo = true;
    }
    // Temiz cephe bandı: her binanın doğrudan fotoğraflı duvarlarından ağaç/gök içermeyen, en keskin
    // 2 katlık (6.2 m) şerit seçilir; temiz olmayan tüm duvarlar bu şeritle döşenir (yatay ayna, dikey kat periyodu).
    const lum = (o) => 0.3 * atlas[o * 3] + 0.59 * atlas[o * 3 + 1] + 0.11 * atlas[o * 3 + 2];
    function metrics(w, y0px, hpx) {
      const [rx, ry, rw] = w.rect;
      let green = 0;
      let sky = 0;
      let sharp = 0;
      let n = 0;
      for (let py = y0px + 1; py < y0px + hpx - 1; py += 2)
        for (let px = 1; px < rw - 1; px += 2) {
          const o = (ry + py) * ATLAS_W + rx + px;
          if (cov[o] !== 1) return null;
          const R = atlas[o * 3];
          const G = atlas[o * 3 + 1];
          const B = atlas[o * 3 + 2];
          if (2 * G - R - B > 16 && G > 30) green++;
          if (isSky(R, G, B)) sky++;
          sharp += Math.abs(4 * lum(o) - lum(o - 1) - lum(o + 1) - lum(o - ATLAS_W) - lum(o + ATLAS_W));
          n++;
        }
      return n ? { green: green / n, sky: sky / n, sharp: sharp / n } : null;
    }
    const bands = new Map();
    for (const w of walls) {
      if (!w.photo || w.len < 3) continue;
      const [, , rw, rh] = w.rect;
      const ppm = rh / (w.y1 - w.y0);
      const hM = Math.min(6.2, w.b.height - 5);
      if (hM < 2.5) continue;
      const hpx = Math.round(hM * ppm);
      const wpx = Math.min(rw, Math.round(7 * ppm));
      for (let topM = w.b.height - 0.6; topM - hM >= 4.5; topM -= 0.5) {
        const y0px = Math.round((w.y1 - (w.y0 + BURY + topM)) * ppm);
        for (let x0 = 0; x0 + wpx <= rw; x0 += Math.max(1, Math.round(ppm))) {
          const m = metrics({ rect: [w.rect[0] + x0, w.rect[1], wpx, rh] }, y0px, hpx);
          if (!m) continue;
          // Dik ve yakın bakış (viewScore) şart: açılı karelerde yatay çizgiler eğik kalıyor
          const sc =
            m.sharp * Math.max(0, 1 - 4 * m.green - 6 * m.sky) * Math.min(1, wpx / (6 * ppm)) * w.viewScore;
          const cur = bands.get(w.b.id);
          if (sc > 0 && (!cur || sc > cur.sc)) bands.set(w.b.id, { sc, w, x0, wpx, y0px, hpx, ppm, m });
        }
      }
    }
    // Şeritleri kopyala (atlas birazdan üzerine yazılacak)
    for (const b of bands.values()) {
      const rx = b.w.rect[0] + b.x0;
      const ry = b.w.rect[1];
      const rw = b.wpx;
      b.rw = rw;
      b.px = new Float32Array(rw * b.hpx * 3);
      for (let py = 0; py < b.hpx; py++)
        b.px.set(
          atlas.subarray(
            ((ry + b.y0px + py) * ATLAS_W + rx) * 3,
            ((ry + b.y0px + py) * ATLAS_W + rx + rw) * 3,
          ),
          py * rw * 3,
        );
    }
    const bandList = [...bands.values()];
    const cent = new Map(targets.map((b) => [b.id, centroid(b.ring)]));
    let kept = 0;
    for (const w of walls) {
      const [rx, ry, rw, rh] = w.rect;
      const ppm = rh / (w.y1 - w.y0);
      const gb = Math.round((2.8 + BURY) * ppm);
      if (w.photo) {
        const m = metrics(w, 0, Math.max(4, rh - gb));
        if (m && m.green < 0.05 && m.sky < 0.02) {
          w.clean = true;
          kept += w.len;
          continue;
        }
      }
      let b = bands.get(w.b.id);
      if (!b && bandList.length) {
        const c = cent.get(w.b.id);
        let bs = Infinity;
        for (const x of bandList) {
          const cx = cent.get(x.w.b.id);
          const sc = Math.hypot(cx[0] - c[0], cx[1] - c[1]) + Math.abs(x.w.b.height - w.b.height) * 3;
          if (sc < bs) {
            bs = sc;
            b = x;
          }
        }
      }
      if (!b) continue;
      w.donor = `${b.w.b.id}:${b.w.i}`;
      // Duvarın üstü (çatı hizası) şeridin üstüyle hizalı; aşağı doğru şerit yüksekliği periyoduyla tekrar
      const hpxT = Math.round(b.hpx * (ppm / b.ppm));
      for (let py = 0; py < rh; py++) {
        const sy = Math.min(b.hpx - 1, Math.floor(((py % hpxT) / hpxT) * b.hpx));
        for (let px = 0; px < rw; px++) {
          const sx = px % b.rw; // düz tekrar (ayna açılı karelerde V deseni yapıyordu)
          const o = ((ry + py) * ATLAS_W + rx + px) * 3;
          const so = (sy * b.rw + sx) * 3;
          atlas[o] = b.px[so];
          atlas[o + 1] = b.px[so + 1];
          atlas[o + 2] = b.px[so + 2];
        }
      }
      w.photo = false;
    }
    console.log(`cephe şeridi: ${bands.size} bina; temiz doğrudan fotoğraf ${kept.toFixed(0)} m`);
    // Zemin bandı: fotoğraflarda alt katlar çit/çalı/araç arkasında kalıyor; 3D çit ayrıca var.
    // KARAR: tabandan GROUND_BAND m'ye kadar olan kısmı hemen üstündeki temiz duvar bandından (aynalı) doldur.
    const GROUND_BAND = Number(process.env.SV_GBAND ?? 2.8);
    for (const w of walls) {
      const [rx, ry, rw, rh] = w.rect;
      const pxPerM = rh / (w.y1 - w.y0);
      const bandPx = Math.min(rh - 2, Math.round((GROUND_BAND + BURY) * pxPerM));
      const srcPx = Math.max(4, Math.round(1.6 * pxPerM)); // üstteki 1.6 m'lik şerit
      const top = rh - bandPx; // bandın üst sınırı (atlas satırı, yukarıdan)
      if (top - srcPx < 0) continue;
      for (let py = top; py < rh; py++) {
        const k = py - top;
        const t = Math.floor(k / srcPx);
        let sy = k % srcPx;
        void t; // düz tekrar
        const sRow = top - srcPx + sy;
        const dOff = ((ry + py) * ATLAS_W + rx) * 3;
        const sOff = ((ry + sRow) * ATLAS_W + rx) * 3;
        atlas.copyWithin(dOff, sOff, sOff + rw * 3);
      }
    }
    await writeRGB(atlas, ATLAS_W, AH, 'facades.jpg', 88);
    const photoLen = walls.filter((w) => w.photo).reduce((a, w) => a + w.len, 0);
    const allLen = walls.reduce((a, w) => a + w.len, 0);
    await writeFile(
      join(outDir, 'facades.json'),
      JSON.stringify({
        slug: SLUG,
        atlas: [ATLAS_W, AH],
        ppm: PPM,
        walls: walls
          .filter((w) => w.photo || w.donor)
          .map((w) => ({
            b: w.b.id,
            a: w.a,
            e: w.e,
            y0: +w.y0.toFixed(3),
            y1: +w.y1.toFixed(3),
            rect: w.rect,
            cover: 1,
            photo: w.photo,
            pano: w.pano,
            n: w.n.map((v) => +v.toFixed(4)),
          })),
      }),
    );
    console.log(
      `✓ cephe: ${photoLen.toFixed(0)}/${allLen.toFixed(0)} m doğrudan fotoğraf, geri kalanı bina şeridinden (${bandList.length} şerit)`,
    );
  }

  // ───────────── 2) Çitler ─────────────
  if (ONLY.includes('fences')) {
    // Google aracının geçtiği her nokta yoldur: çit hattı panoramalardan en az FENCE_CLEAR m uzakta olmalı
    const FENCE_CLEAR = Number(process.env.SV_FCLEAR ?? 4.5);
    const rawSegs = siteFences(osm, bbox).map((s) => {
      const nx = s[4];
      const nz = s[5];
      let push = 0;
      for (const p of index.panos) {
        for (const t of [0, 0.5, 1]) {
          const x = s[0] + (s[2] - s[0]) * t;
          const z = s[1] + (s[3] - s[1]) * t;
          const dx = p.x - x;
          const dz = p.z - z;
          // Panoramanın çit hattına dik uzaklığı (yol tarafında, çit boyunca ±3 m içinde)
          const along = Math.abs(dx * -nz + dz * nx);
          if (along > 3.5) continue;
          const perp = -(dx * nx + dz * nz); // + ise panorama yol tarafında
          if (perp > -1 && perp < FENCE_CLEAR) push = Math.max(push, FENCE_CLEAR - perp);
        }
      }
      if (push > 6) return null; // çok fazla itme gerekiyorsa bu çit yanlış yerde: at
      return [s[0] + nx * push, s[1] + nz * push, s[2] + nx * push, s[3] + nz * push, nx, nz];
    });
    const segs = rawSegs.filter(Boolean).map((s) => {
      const a = [s[0], s[1]];
      const e = [s[2], s[3]];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      const y0 = Math.min(H(a[0], a[1]), H(e[0], e[1])) - 0.1;
      return {
        a,
        e,
        len,
        y0,
        y1: y0 + 0.1 + FENCE_H,
        n: [-s[4], -s[5]], // yola bakan yüz
        w: Math.max(2, Math.ceil(len * PPM)),
        h: Math.ceil((FENCE_H + 0.1) * PPM),
        maxd: 22,
      };
    });
    const rowH = Math.max(...segs.map((w) => w.h));
    const AH = pack(segs, rowH);
    const atlas = new Float32Array(ATLAS_W * AH * 3);
    const cov = new Uint8Array(ATLAS_W * AH);
    const alpha = new Uint8Array(ATLAS_W * AH);
    for (const w of segs) {
      w.cover = await bakeStrip(w, atlas, ATLAS_W, cov, null);
      // Alt %70'te gökyüzü çoksa (çitin arkasını değil başka yeri görüyor) reddet
      w.sky = skyFrac(atlas, cov, ATLAS_W, {
        rect: [w.rect[0], w.rect[1] + Math.floor(w.h * 0.3), w.w, Math.ceil(w.h * 0.7)],
      });
      w.photo = w.cover > 0.6 && w.sky < 0.2;
      const [rx, ry, rw, rh] = w.rect;
      for (let py = 0; py < rh; py++)
        for (let px = 0; px < rw; px++) {
          const o = (ry + py) * ATLAS_W + rx + px;
          if (!w.photo) cov[o] = 0;
          alpha[o] = cov[o] && !isSky(atlas[o * 3], atlas[o * 3 + 1], atlas[o * 3 + 2]) ? 255 : 0;
        }
    }
    const donors = segs.filter((w) => w.photo && w.cover > 0.9).sort((a, b) => b.len - a.len);
    for (const w of segs) {
      if (w.photo) continue;
      // En yakın fotoğraflı çit parçasından döşe
      const mx = (w.a[0] + w.e[0]) / 2;
      const mz = (w.a[1] + w.e[1]) / 2;
      let d = null;
      let bd = Infinity;
      for (const x of donors) {
        const dd = Math.hypot((x.a[0] + x.e[0]) / 2 - mx, (x.a[1] + x.e[1]) / 2 - mz);
        if (dd < bd) {
          bd = dd;
          d = x;
        }
      }
      if (d) tileFrom(atlas, cov, ATLAS_W, w, d, alpha);
      w.donor = !!d;
    }
    const rgba = Buffer.alloc(ATLAS_W * AH * 4);
    for (let i = 0; i < ATLAS_W * AH; i++) {
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.max(0, Math.min(255, Math.round(atlas[i * 3 + k])));
      rgba[i * 4 + 3] = alpha[i];
    }
    // Alfa kenarlarını yumuşat (tek piksellik gürültüyü temizle)
    // Çit görünümü oyunda çalı dokusuyla kurulur; bu atlas yalnızca teşhis için (SV_DEBUG=1)
    if (process.env.SV_DEBUG === '1')
      await sharp(rgba, { raw: { width: ATLAS_W, height: AH, channels: 4 } })
        .png()
        .toFile(join(outDir, 'fences.png'));
    await writeFile(
      join(outDir, 'fences.json'),
      JSON.stringify({
        atlas: [ATLAS_W, AH],
        segs: segs
          .filter((w) => w.photo || w.donor)
          .map((w) => ({
            a: w.a.map((v) => +v.toFixed(2)),
            e: w.e.map((v) => +v.toFixed(2)),
            y0: +w.y0.toFixed(3),
            y1: +w.y1.toFixed(3),
            rect: w.rect,
            n: w.n.map((v) => +v.toFixed(4)),
            photo: w.photo,
          })),
      }),
    );
    console.log(`✓ çit: ${segs.filter((w) => w.photo).length}/${segs.length} parça doğrudan fotoğraf`);
  }

  // ───────────── 3) Zemin ortofoto ─────────────
  if (ONLY.includes('ground')) {
    const [x0, z0, x1, z1] = bbox;
    const GW = Math.ceil((x1 - x0) / GROUND_RES);
    const GH = Math.ceil((z1 - z0) / GROUND_RES);
    const col = new Float32Array(GW * GH * 3);
    const mask = new Uint8Array(GW * GH);
    const blds = all.filter((b) => {
      const [cx, cz] = centroid(b.ring);
      return cx > x0 - 40 && cx < x1 + 40 && cz > z0 - 40 && cz < z1 + 40;
    });
    // Panorama ızgarası (yakın arama)
    const cell = 10;
    const grid = new Map();
    for (const p of index.panos) {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    const tanMin = Math.tan((DEP_MIN * Math.PI) / 180);
    const tanMax = Math.tan((DEP_MAX * Math.PI) / 180);
    const tmp = [0, 0, 0];
    let filled = 0;
    // 16 m'lik bloklar hâlinde (görüntü önbelleği yerelliği)
    const BS = Math.round(16 / GROUND_RES);
    for (let by = 0; by < GH; by += BS)
      for (let bx = 0; bx < GW; bx += BS)
        for (let gy = by; gy < Math.min(GH, by + BS); gy++) {
          const z = z0 + (gy + 0.5) * GROUND_RES;
          for (let gx = bx; gx < Math.min(GW, bx + BS); gx++) {
            const x = x0 + (gx + 0.5) * GROUND_RES;
            const y = H(x, z) + 0.05;
            // Aday panoramalar: aşağı bakış açısı aralığında, engelsiz
            const cand = [];
            const cx = Math.floor(x / cell);
            const cz = Math.floor(z / cell);
            for (let ox = -2; ox <= 2; ox++)
              for (let oz = -2; oz <= 2; oz++) {
                const list = grid.get(`${cx + ox},${cz + oz}`);
                if (!list) continue;
                for (const p of list) {
                  const d = Math.hypot(p.x - x, p.z - z);
                  const dh = H(p.x, p.z) + index.camHeight - y;
                  if (dh / d < tanMin || dh / d > tanMax) continue;
                  cand.push({ p, d });
                }
              }
            if (!cand.length) continue;
            if (blds.some((b) => inside(b.ring, x, z))) continue;
            cand.sort((a, b) => a.d - b.d);
            let sw = 0;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let used = 0;
            for (const { p, d } of cand) {
              if (used >= 2) break;
              if (occ.blocked(p.x, p.z, x, z, null)) continue;
              const list = panoCams.get(p.id);
              let best = -1;
              let bu = 0;
              let bv = 0;
              let be = -1;
              for (let k = 0; k < list.length; k++) {
                const pr = proj(list[k], x, y, z);
                if (!pr || pr[1] > S * 0.97) continue;
                const e = Math.min(pr[0], pr[1], S - pr[0], S - pr[1]);
                if (e > be) {
                  be = e;
                  best = k;
                  bu = pr[0];
                  bv = pr[1];
                }
              }
              if (best < 0) continue;
              const im = imgCache.get(list[best].file) ?? (await img(list[best].file));
              rgb(im, bu, bv, tmp, 0);
              const wgt = 1 / Math.pow(d + 0.5, 4);
              sr += tmp[0] * wgt;
              sg += tmp[1] * wgt;
              sb += tmp[2] * wgt;
              sw += wgt;
              used++;
            }
            if (!sw) continue;
            const o = gy * GW + gx;
            col[o * 3] = sr / sw;
            col[o * 3 + 1] = sg / sw;
            col[o * 3 + 2] = sb / sw;
            mask[o] = 255;
            filled++;
          }
        }
    await writeRGB(col, GW, GH, 'ground.jpg', 84);
    await sharp(Buffer.from(mask), { raw: { width: GW, height: GH, channels: 1 } })
      .blur(2)
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, 'ground-mask.png'));
    await writeFile(
      join(outDir, 'ground.json'),
      JSON.stringify({ bbox: [x0, z0, x1, z1], size: [GW, GH], res: GROUND_RES }),
    );
    console.log(`✓ zemin: ${GW}×${GH}, %${((filled / (GW * GH)) * 100).toFixed(1)} kaplı`);
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

#!/usr/bin/env node
// Cephe düzlemi ofseti (plane sweep): aynı cepheyi gören iki+ panoramanın karolarını, OSM kenarından dış normal
// boyunca δ kadar kaydırılmış düzleme projekte eder; gradyan NCC'nin en yüksek olduğu δ gerçek cephe düzlemidir.
// Balkonlu cephelerde iki tepe çıkabilir (balkon alnı / duvar) — ilk 3 tepe yazdırılır.
// Kullanım: node --experimental-strip-types scripts/sv-plane.mjs <binaId> [kenar,...]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = 640;
const CAM_H = 2.5;
const PX = Number(process.env.PX ?? 6);
const BLUR = Number(process.env.BLUR ?? 1);
const VERBOSE = !!process.env.VERBOSE;
const SHIFT_U = Number(process.env.SHIFT_U ?? 0);
const SHIFT_Y = Number(process.env.SHIFT_Y ?? 0);
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

function camOf(x, y, z, hDeg, pDeg) {
  const h = (hDeg * Math.PI) / 180;
  const p = (pDeg * Math.PI) / 180;
  const f = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { c: [x, y, z], f, r, u, focal: S / 2 / Math.tan((40 * Math.PI) / 360) };
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

/** Düzlem görüntüsü: gri + maske (gök/bitki/yok = 0) */
function render(tiles, W, Hh, point) {
  const g = new Float32Array(W * Hh);
  const m = new Uint8Array(W * Hh);
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
      const c = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const a = bt.data;
        c[k] =
          a[(y0 * S + x0) * 3 + k] * (1 - fx) * (1 - fy) +
          a[(y0 * S + x0 + 1) * 3 + k] * fx * (1 - fy) +
          a[((y0 + 1) * S + x0) * 3 + k] * (1 - fx) * fy +
          a[((y0 + 1) * S + x0 + 1) * 3 + k] * fx * fy;
      }
      const [r, gg, b] = c;
      const sky = b > r + 25 && b > gg + 5 && b > 120;
      const veg = gg > r + 6 && gg > b + 4;
      g[j * W + i] = 0.3 * r + 0.59 * gg + 0.11 * b;
      m[j * W + i] = sky || veg ? 0 : 1;
    }
  return { g, m };
}

function blur(img, W, Hh, r) {
  // Maskeli kutu bulanıklaştırma (yatay + dikey)
  const g = img.g;
  const m = img.m;
  const out = new Float32Array(W * Hh);
  const tmp = new Float32Array(W * Hh);
  const tw = new Float32Array(W * Hh);
  for (let j = 0; j < Hh; j++)
    for (let i = 0; i < W; i++) {
      let s = 0;
      let w = 0;
      for (let k = -r; k <= r; k++) {
        const ii = i + k;
        if (ii < 0 || ii >= W || !m[j * W + ii]) continue;
        s += g[j * W + ii];
        w++;
      }
      tmp[j * W + i] = s;
      tw[j * W + i] = w;
    }
  for (let j = 0; j < Hh; j++)
    for (let i = 0; i < W; i++) {
      let s = 0;
      let w = 0;
      for (let k = -r; k <= r; k++) {
        const jj = j + k;
        if (jj < 0 || jj >= Hh) continue;
        s += tmp[jj * W + i];
        w += tw[jj * W + i];
      }
      out[j * W + i] = w ? s / w : 0;
    }
  img.g = out;
}

function grad(img, W, Hh) {
  if (BLUR) blur(img, W, Hh, BLUR);
  const gx = new Float32Array(W * Hh);
  const gy = new Float32Array(W * Hh);
  for (let j = 1; j < Hh - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const o = j * W + i;
      gx[o] = img.g[o + 1] - img.g[o - 1];
      gy[o] = img.g[o + W] - img.g[o - W];
    }
  return { gx, gy };
}

function ncc(A, B, W, Hh, sx = 0, sy = 0) {
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  let n = 0;
  for (let j = 1; j < Hh - 1; j++) {
    const jb = j + sy;
    if (jb < 1 || jb >= Hh - 1) continue;
    for (let i = 1; i < W - 1; i++) {
      const ib = i + sx;
      if (ib < 1 || ib >= W - 1) continue;
      const o = j * W + i;
      const ob = jb * W + ib;
      if (!A.m[o] || !B.m[ob] || !A.m[o - 1] || !A.m[o + 1] || !B.m[ob - 1] || !B.m[ob + 1]) continue;
      sab += A.gx[o] * B.gx[ob] + A.gy[o] * B.gy[ob];
      saa += A.gx[o] ** 2 + A.gy[o] ** 2;
      sbb += B.gx[ob] ** 2 + B.gy[ob] ** 2;
      n++;
    }
  }
  return { v: n > 200 ? sab / Math.sqrt(saa * sbb + 1e-6) : 0, n };
}

/** Poz hatalarını yutmak için küçük kaydırmalar üzerinde en iyi NCC */
function nccShift(A, B, W, Hh) {
  const RX = Math.round(SHIFT_U * PX);
  const RY = Math.round(SHIFT_Y * PX);
  let best = { v: -1, n: 0, sx: 0, sy: 0 };
  for (let sy = -RY; sy <= RY; sy++)
    for (let sx = -RX; sx <= RX; sx++) {
      const r = ncc(A, B, W, Hh, sx, sy);
      if (r.v > best.v) best = { ...r, sx, sy };
    }
  return best;
}

async function main() {
  const id = Number(process.argv[2]);
  const onlyEdges = process.argv[3] ? new Set(process.argv[3].split(',').map(Number)) : null;
  const cfg = JSON.parse(await readFile(join(root, 'scripts', 'sv-extra.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const pos = new Map(idx.panos.map((p) => [p.id, p]));
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  // Pano → tüm 40° karoları (her kenar için, o panonun tüm karoları kullanılır)
  const byPano = new Map();
  for (const r of cfg.requests) {
    if (r.fov !== 40) continue;
    if (!byPano.has(r.pano)) byPano.set(r.pano, []);
    byPano.get(r.pano).push(r);
  }
  const cache = new Map();
  const loadTiles = async (pid) => {
    if (cache.has(pid)) return cache.get(pid);
    const p = pos.get(pid);
    const cy = H(p.x, p.z) + CAM_H;
    const out = [];
    for (const t of byPano.get(pid) ?? []) {
      const file = join(root, 'streetview-src', 'extra', `${pid}_${t.h}_${t.p}_40.jpg`);
      if (!(await exists(file))) continue;
      const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      out.push({ cam: camOf(p.x, cy, p.z, t.h, t.p), data });
    }
    cache.set(pid, out);
    return out;
  };
  const edges = new Map();
  if (process.env.SEG) {
    // Serbest parça: SEG="ax,az,ex,ez;..."  (YLO/YHI: zeminden yükseklik aralığı)
    let k = 0;
    for (const q of process.env.SEG.split(';')) {
      const [ax, az, ex, ez] = q.split(',').map(Number);
      edges.set(k++, {
        s: { a: [ax, az], e: [ex, ez], base: H((ax + ex) / 2, (az + ez) / 2) },
        panos: [],
      });
    }
  } else
    for (const s of cfg.survey) {
      if (s.building !== id || (onlyEdges && !onlyEdges.has(s.edge))) continue;
      if (!edges.has(s.edge)) edges.set(s.edge, { s, panos: [] });
    }
  const YLO = Number(process.env.YLO ?? 3.2);
  const YHI = Number(process.env.YHI ?? 18.2);
  const MAXD = Number(process.env.MAXD ?? 45);
  // Kenarın orta noktasını (zemin+8 m) herhangi bir karosunda gören, dış taraftaki tüm panolar
  for (const { s, panos } of edges.values()) {
    const [ax, az] = s.a;
    const [ex, ez] = s.e;
    const len = Math.hypot(ex - ax, ez - az);
    const nx = -(ez - az) / len;
    const nz = (ex - ax) / len;
    const mx = (ax + ex) / 2;
    const mz = (az + ez) / 2;
    for (const [pid, reqs] of byPano) {
      const p = pos.get(pid);
      if (!p || (p.date && p.date < '2020')) continue;
      const d = Math.hypot(p.x - mx, p.z - mz);
      if (d > MAXD || ((p.x - mx) * nx + (p.z - mz) * nz) / d < 0.25) continue;
      const cy = H(p.x, p.z) + CAM_H;
      let seen = 0;
      for (const f of [0.15, 0.5, 0.85]) {
        const P = [ax + (ex - ax) * f, s.base + (YLO + YHI) / 2, az + (ez - az) * f];
        if (
          reqs.some((t) => {
            const q = project(camOf(p.x, cy, p.z, t.h, t.p), P);
            return q && q[0] > 20 && q[1] > 20 && q[0] < S - 20 && q[1] < S - 20;
          })
        )
          seen++;
      }
      if (seen >= 2) panos.push(pid);
    }
  }
  const dump = [];
  for (const [edge, { s, panos }] of [...edges].sort((a, b) => a[0] - b[0])) {
    if (panos.length < 2) {
      console.log(`kenar ${edge}: tek pano, atlandı`);
      continue;
    }
    const [ax, az] = s.a;
    const [ex, ez] = s.e;
    const len = Math.hypot(ex - ax, ez - az);
    const tx = (ex - ax) / len;
    const tz = (ez - az) / len;
    const nx = -tz;
    const nz = tx;
    const W = Math.round(len * PX);
    const y0 = s.base + YLO;
    const Hh = Math.round((YHI - YLO) * PX);
    const TT = [];
    for (const pid of panos.slice(0, Number(process.env.MAXP ?? 5))) TT.push(await loadTiles(pid));
    const res = [];
    for (let d = -4; d <= 2.5001; d += 0.1) {
      const pt = (i, j) => [
        ax + tx * (i / PX) + nx * d,
        y0 + (YHI - YLO) - j / PX,
        az + tz * (i / PX) + nz * d,
      ];
      const R = TT.map((t) => {
        const A = render(t, W, Hh, pt);
        Object.assign(A, grad(A, W, Hh));
        return A;
      });
      let v = 0;
      let n = 0;
      let k = 0;
      for (let a = 0; a < R.length; a++)
        for (let b = a + 1; b < R.length; b++) {
          const r = SHIFT_U || SHIFT_Y ? nccShift(R[a], R[b], W, Hh) : ncc(R[a], R[b], W, Hh);
          if (!r.n) continue;
          if (VERBOSE)
            console.log(
              `     δ=${d.toFixed(1)} ${a}-${b}: ${r.v.toFixed(3)} kay ${((r.sx ?? 0) / PX).toFixed(2)},${((r.sy ?? 0) / PX).toFixed(2)}`,
            );
          v += r.v;
          n += r.n;
          k++;
        }
      res.push({ d: +d.toFixed(2), v: k ? v / k : 0, n });
    }
    // Yerel tepeler
    const peaks = res
      .filter((r, i) => i > 0 && i < res.length - 1 && r.v >= res[i - 1].v && r.v >= res[i + 1].v)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3);
    const curve = res.map((r) => (r.v * 100).toFixed(0).padStart(3)).join('');
    console.log(
      `kenar ${edge} (${len.toFixed(1)} m, ${panos.map((p) => p.slice(0, 4)).join('+')}): tepeler ${peaks
        .map((p) => `δ=${p.d} (${p.v.toFixed(3)}, n=${p.n})`)
        .join(', ')}`,
    );
    console.log(`   eğri −4…2.5: ${curve}`);
    const sorted = res.map((r) => r.v).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    dump.push({
      edge,
      a: s.a,
      e: s.e,
      len: +len.toFixed(2),
      panos,
      med: +med.toFixed(3),
      peaks,
      curve: res.map((r) => +r.v.toFixed(3)),
    });
  }
  if (process.env.OUT_JSON) {
    await mkdir(dirname(process.env.OUT_JSON), { recursive: true });
    await writeFile(process.env.OUT_JSON, JSON.stringify({ building: id, edges: dump }, null, 1));
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});

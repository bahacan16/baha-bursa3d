import { ChunkedGeometry, type Bucket, type MatKey, type Rgb } from './chunks';
import type { Pt, Road } from './parse';
import { H, densify } from './height';

export const SIDEWALK_W = 2;
export const CURB_H = 0.15;

/** Sınıfa göre milimetrik y ofseti (z-fighting'e karşı; malzemelerde polygonOffset de var). */
const Y_MINOR = 0.03;
const Y_MAJOR = 0.04;
const Y_MARK = 0.05;

const ASPHALT: Rgb = [0.24, 0.245, 0.25];
const ASPHALT_SERVICE: Rgb = [0.3, 0.3, 0.3];
const PAVER: Rgb = [0.52, 0.47, 0.42];
const PATH: Rgb = [0.6, 0.53, 0.42];
const CYCLE: Rgb = [0.55, 0.3, 0.27];
const SIDEWALK: Rgb = [0.5, 0.45, 0.42];
const CURB: Rgb = [0.78, 0.77, 0.74];
const WHITE: Rgb = [0.92, 0.92, 0.9];

/** Kaldırım / yükseltilmiş şerit — zemin yüksekliği sorgusu için. */
export interface RaisedStrip {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  inner: number;
  outer: number;
  height: number;
}

/** Araç yolu şeridi — kaldırım üstünde değil kontrolü için. */
export interface Carriageway {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

export interface RoadBuildResult {
  strips: RaisedStrip[];
  carriageways: Carriageway[];
}

function keyOf(p: Pt): string {
  return `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
}

function roadStyle(r: Road): { mat: MatKey; color: Rgb; y: number } {
  if (r.vehicular) return { mat: 'roadMajor', color: ASPHALT, y: Y_MAJOR };
  switch (r.kind) {
    case 'service':
    case 'living_street':
    case 'track':
      return { mat: 'roadMinor', color: r.kind === 'track' ? PATH : ASPHALT_SERVICE, y: Y_MINOR };
    case 'cycleway':
      return { mat: 'roadMinor', color: CYCLE, y: Y_MINOR };
    case 'path':
    case 'bridleway':
      return { mat: 'roadMinor', color: PATH, y: Y_MINOR };
    default:
      // Yaya yolları: kilitli parke taşı dokusu
      return { mat: 'footway', color: PAVER, y: Y_MINOR };
  }
}

/**
 * Ofsetli polyline şeridi. Birleşimlerde gönye (miter) sınırlı.
 * Dönüş: her nokta için sol/sağ ofset noktaları.
 */
export function offsetPolyline(pts: Pt[], off: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let nx: number;
    let nz: number;
    if (i === 0 || i === n - 1) {
      const a = i === 0 ? pts[0] : prev;
      const b = i === 0 ? next : pts[n - 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      nx = -dz / l;
      nz = dx / l;
    } else {
      const d1x = pts[i][0] - prev[0];
      const d1z = pts[i][1] - prev[1];
      const d2x = next[0] - pts[i][0];
      const d2z = next[1] - pts[i][1];
      const l1 = Math.hypot(d1x, d1z) || 1;
      const l2 = Math.hypot(d2x, d2z) || 1;
      const n1x = -d1z / l1;
      const n1z = d1x / l1;
      const n2x = -d2z / l2;
      const n2z = d2x / l2;
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        mx = n1x;
        mz = n1z;
      } else {
        mx /= ml;
        mz /= ml;
      }
      const cos = mx * n1x + mz * n1z;
      const scale = 1 / Math.max(cos, 0.5); // gönye sınırı 2×
      nx = mx * scale;
      nz = mz * scale;
    }
    out.push([pts[i][0] + nx * off, pts[i][1] + nz * off]);
  }
  return out;
}

function polyLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Polyline'ı baştan `a`, sondan `b` metre kırpar. */
export function trimPolyline(pts: Pt[], a: number, b: number): Pt[] | null {
  const L = polyLength(pts);
  if (L - a - b < 0.5) return null;
  const out: Pt[] = [];
  let acc = 0;
  const s0 = a;
  const s1 = L - b;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const lerp = (s: number): Pt => {
      const t = d > 0 ? (s - acc) / d : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    if (acc + d >= s0 && acc <= s1) {
      if (!out.length) out.push(lerp(Math.max(s0, acc)));
      if (acc + d <= s1) out.push(q);
      else {
        out.push(lerp(s1));
        break;
      }
    }
    acc += d;
  }
  return out.length >= 2 ? out : null;
}

/** Şerit mesh'i: pts boyunca `half` yarı genişlikte, y kotunda. Her segment kendi chunk'ına. */
function ribbon(geo: ChunkedGeometry, mat: MatKey, pts: Pt[], half: number, y: number, c: Rgb): void {
  if (pts.length < 2) return;
  const L = offsetPolyline(pts, half);
  const R = offsetPolyline(pts, -half);
  let v = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const b = geo.get(mx, mz, mat);
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const a0 = b.v(L[i][0], y + H(L[i][0], L[i][1]), L[i][1], 0, 1, 0, 0, v, c);
    const b0 = b.v(R[i][0], y + H(R[i][0], R[i][1]), R[i][1], 0, 1, 0, half * 2, v, c);
    const a1 = b.v(L[i + 1][0], y + H(L[i + 1][0], L[i + 1][1]), L[i + 1][1], 0, 1, 0, 0, v + d, c);
    const b1 = b.v(R[i + 1][0], y + H(R[i + 1][0], R[i + 1][1]), R[i + 1][1], 0, 1, 0, half * 2, v + d, c);
    v += d;
    // Sol = +normal (−dz, dx). Yukarıdan saat yönü tersi için sırayı çapraz çarpımla belirle.
    upQuad(b, a0, b0, b1, a1);
  }
}

/** Dört yatay köşeyi yukarı bakan iki üçgen olarak ekler. */
function upQuad(b: Bucket, i0: number, i1: number, i2: number, i3: number): void {
  const P = b.pos;
  const cross =
    (P[i1 * 3] - P[i0 * 3]) * (P[i2 * 3 + 2] - P[i0 * 3 + 2]) -
    (P[i1 * 3 + 2] - P[i0 * 3 + 2]) * (P[i2 * 3] - P[i0 * 3]);
  if (cross < 0) b.quad(i0, i1, i2, i3);
  else b.quad(i0, i3, i2, i1);
}

/** Yatay disk (kavşak dolgusu / yol ucu kapakları). */
function disc(b: Bucket, x: number, z: number, r: number, y: number, c: Rgb, seg = 8): void {
  const center = b.v(x, y + H(x, z), z, 0, 1, 0, x, z, c);
  const ring: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    ring.push(b.v(px, y + H(px, pz), pz, 0, 1, 0, px, pz, c));
  }
  for (let i = 0; i < seg; i++) {
    // a artarken (cos, sin) x-z düzleminde yukarıdan bakınca saat yönünde → ters sırala
    b.tri(center, ring[(i + 1) % seg], ring[i]);
  }
}

/** Dikey şerit (bordür yüzü): p→q boyunca, y0..y1, normal (nx,nz) yönünde. */
function vstrip(b: Bucket, p: Pt, q: Pt, y0: number, y1: number, c: Rgb, towards: Pt): void {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const l = Math.hypot(dx, dz) || 1;
  let nx = dz / l;
  let nz = -dx / l;
  const mx = (p[0] + q[0]) / 2;
  const mz = (p[1] + q[1]) / 2;
  const flip = (towards[0] - mx) * nx + (towards[1] - mz) * nz < 0;
  if (flip) {
    nx = -nx;
    nz = -nz;
  }
  const hp = H(p[0], p[1]);
  const hq = H(q[0], q[1]);
  const a = b.v(p[0], y0 + hp, p[1], nx, 0, nz, 0, 0, c);
  const bb = b.v(q[0], y0 + hq, q[1], nx, 0, nz, l, 0, c);
  const cc = b.v(q[0], y1 + hq, q[1], nx, 0, nz, l, y1 - y0, c);
  const d = b.v(p[0], y1 + hp, p[1], nx, 0, nz, 0, y1 - y0, c);
  // normal = (dz, −dx) iken ön yüz sırası (a, d, cc, bb) — duvarlarla aynı kural
  if (flip) b.quad(a, bb, cc, d);
  else b.quad(a, d, cc, bb);
}

/** Kaldırım: yolun bir yanında, iç kenar `half`, dış kenar `half + SIDEWALK_W`. */
function sidewalk(geo: ChunkedGeometry, pts: Pt[], half: number, side: 1 | -1, strips: RaisedStrip[]): void {
  const inner = offsetPolyline(pts, side * half);
  const outer = offsetPolyline(pts, side * (half + SIDEWALK_W));
  for (let i = 0; i + 1 < pts.length; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const b = geo.get(mx, mz, 'sidewalk');
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const Y = (p: Pt) => CURB_H + H(p[0], p[1]);
    const i0 = b.v(inner[i][0], Y(inner[i]), inner[i][1], 0, 1, 0, 0, 0, SIDEWALK);
    const i1 = b.v(outer[i][0], Y(outer[i]), outer[i][1], 0, 1, 0, SIDEWALK_W, 0, SIDEWALK);
    const i2 = b.v(outer[i + 1][0], Y(outer[i + 1]), outer[i + 1][1], 0, 1, 0, SIDEWALK_W, d, SIDEWALK);
    const i3 = b.v(inner[i + 1][0], Y(inner[i + 1]), inner[i + 1][1], 0, 1, 0, 0, d, SIDEWALK);
    upQuad(b, i0, i1, i2, i3);
    // Bordür (yola bakan) ve dış kenar yüzleri
    const road: Pt = [pts[i][0], pts[i][1]];
    vstrip(b, inner[i], inner[i + 1], 0, CURB_H, CURB, road);
    const away: Pt = [outer[i][0] * 2 - road[0], outer[i][1] * 2 - road[1]];
    vstrip(b, outer[i], outer[i + 1], 0, CURB_H, SIDEWALK, away);
    strips.push({
      ax: pts[i][0],
      az: pts[i][1],
      bx: pts[i + 1][0],
      bz: pts[i + 1][1],
      inner: half,
      outer: half + SIDEWALK_W,
      height: CURB_H,
    });
  }
  // Uç yüzleri
  for (const k of [0, pts.length - 1]) {
    const b = geo.get(pts[k][0], pts[k][1], 'sidewalk');
    const j = k === 0 ? 1 : pts.length - 2;
    vstrip(b, inner[k], outer[k], 0, CURB_H, CURB, [2 * pts[k][0] - pts[j][0], 2 * pts[k][1] - pts[j][1]]);
  }
}

function dashes(geo: ChunkedGeometry, pts: Pt[], on: number, off: number, w: number, y: number): void {
  let phase = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    const ux = dx / d;
    const uz = dz / d;
    let s = -phase;
    while (s < d) {
      const s0 = Math.max(0, s);
      const s1 = Math.min(d, s + on);
      if (s1 > s0 + 0.2) {
        const ax = p[0] + ux * s0;
        const az = p[1] + uz * s0;
        const bx = p[0] + ux * s1;
        const bz = p[1] + uz * s1;
        const b = geo.get(ax, az, 'marking');
        const nx = -uz * (w / 2);
        const nz = ux * (w / 2);
        const ya = y + H(ax, az);
        const yb = y + H(bx, bz);
        const i0 = b.v(ax + nx, ya, az + nz, 0, 1, 0, 0, 0, WHITE);
        const i1 = b.v(ax - nx, ya, az - nz, 0, 1, 0, 1, 0, WHITE);
        const i2 = b.v(bx - nx, yb, bz - nz, 0, 1, 0, 1, 1, WHITE);
        const i3 = b.v(bx + nx, yb, bz + nz, 0, 1, 0, 0, 1, WHITE);
        upQuad(b, i0, i1, i2, i3);
      }
      s += on + off;
    }
    phase = (phase + d) % (on + off);
  }
}

function zebra(geo: ChunkedGeometry, at: Pt, dir: Pt, width: number): void {
  const b = geo.get(at[0], at[1], 'marking');
  const ux = dir[0];
  const uz = dir[1];
  const nx = -uz;
  const nz = ux;
  const len = 3; // yol boyunca
  const stripe = 0.5;
  const n = Math.max(2, Math.floor((width - 0.6) / (stripe * 2)));
  const start = -((n - 1) * stripe * 2) / 2;
  for (let k = 0; k < n; k++) {
    const o = start + k * stripe * 2;
    const cx = at[0] + nx * o;
    const cz = at[1] + nz * o;
    const hx = nx * (stripe / 2);
    const hz = nz * (stripe / 2);
    const lx = ux * (len / 2);
    const lz = uz * (len / 2);
    const Y = (x: number, z: number) => Y_MARK + H(x, z);
    const i0 = b.v(cx - hx - lx, Y(cx - hx - lx, cz - hz - lz), cz - hz - lz, 0, 1, 0, 0, 0, WHITE);
    const i1 = b.v(cx + hx - lx, Y(cx + hx - lx, cz + hz - lz), cz + hz - lz, 0, 1, 0, 1, 0, WHITE);
    const i2 = b.v(cx + hx + lx, Y(cx + hx + lx, cz + hz + lz), cz + hz + lz, 0, 1, 0, 1, 1, WHITE);
    const i3 = b.v(cx - hx + lx, Y(cx - hx + lx, cz - hz + lz), cz - hz + lz, 0, 1, 0, 0, 1, WHITE);
    upQuad(b, i0, i1, i2, i3);
  }
}

/** Tüm yolları, kaldırımları, çizgileri ve yaya geçitlerini üretir. */
export function buildRoads(geo: ChunkedGeometry, roads: Road[], crossings: Pt[]): RoadBuildResult {
  const strips: RaisedStrip[] = [];
  const carriageways: Carriageway[] = [];
  const visible = roads.filter((r) => !r.tunnel);

  // Kavşak düğümleri: araç yollarının paylaştığı noktalar → kaldırım kırpma mesafesi
  const nodeRoads = new Map<string, Road[]>();
  for (const r of visible) {
    for (const p of r.pts) {
      const k = keyOf(p);
      let a = nodeRoads.get(k);
      if (!a) nodeRoads.set(k, (a = []));
      if (!a.includes(r)) a.push(r);
    }
  }
  // Önce geniş yollar: aynı y'de üst üste binmeler aynı renkte olduğundan görünmez.
  const sorted = visible.slice().sort((a, b) => a.width - b.width);
  for (const r of sorted) {
    const st = roadStyle(r);
    const half = r.width / 2;
    const dense = densify(r.pts);
    ribbon(geo, st.mat, dense, half, st.y, st.color);
    // Uç kapakları (kavşak dolgusu)
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]])
      disc(geo.get(p[0], p[1], st.mat), p[0], p[1], half, st.y, st.color);
    // Yol ortasındaki kavşaklar (bir başka yolun ucu bu yolun iç noktasına bağlanıyorsa)
    for (let i = 1; i + 1 < r.pts.length; i++) {
      const k = keyOf(r.pts[i]);
      const others = nodeRoads.get(k);
      if (others && others.length > 1)
        disc(geo.get(r.pts[i][0], r.pts[i][1], st.mat), r.pts[i][0], r.pts[i][1], half, st.y, st.color);
    }
    if (r.vehicular) {
      for (let i = 0; i + 1 < r.pts.length; i++)
        carriageways.push({
          ax: r.pts[i][0],
          az: r.pts[i][1],
          bx: r.pts[i + 1][0],
          bz: r.pts[i + 1][1],
          half,
        });
    }
    // Orta çizgi: primary ve üstü kesikli beyaz
    if (/^(motorway|trunk|primary)$/.test(r.kind)) dashes(geo, dense, 3, 6, 0.15, Y_MARK);
  }

  // Kaldırımlar: kavşak düğümlerinde parçalara böl ve kırp
  for (const r of visible) {
    if (!r.vehicular || (!r.sidewalkLeft && !r.sidewalkRight)) continue;
    const half = r.width / 2;
    let piece: Pt[] = [r.pts[0]];
    const flush = (endIdx: number) => {
      const startKey = keyOf(piece[0]);
      const endKey = keyOf(r.pts[endIdx]);
      const trimFor = (k: string) => {
        const others = (nodeRoads.get(k) ?? []).filter((o) => o !== r && o.vehicular);
        if (!others.length) return 0;
        return Math.max(...others.map((o) => o.width / 2)) + SIDEWALK_W + 0.5;
      };
      const trimmed = trimPolyline(piece, trimFor(startKey), trimFor(endKey));
      if (trimmed) {
        const dense = densify(trimmed);
        if (r.sidewalkLeft) sidewalk(geo, dense, half, 1, strips);
        if (r.sidewalkRight) sidewalk(geo, dense, half, -1, strips);
      }
    };
    for (let i = 1; i < r.pts.length; i++) {
      piece.push(r.pts[i]);
      const others = (nodeRoads.get(keyOf(r.pts[i])) ?? []).filter((o) => o !== r && o.vehicular);
      if (i === r.pts.length - 1 || others.length) {
        flush(i);
        piece = [r.pts[i]];
      }
    }
  }

  // Yaya geçitleri
  for (const c of crossings) {
    const k = keyOf(c);
    const on = (nodeRoads.get(k) ?? []).find((r) => r.vehicular);
    if (!on) continue;
    const i = on.pts.findIndex((p) => keyOf(p) === k);
    const a = on.pts[Math.max(0, i - 1)];
    const b = on.pts[Math.min(on.pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    zebra(geo, c, [dx / l, dz / l], on.width);
  }
  return { strips, carriageways };
}
